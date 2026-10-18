import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  AnswerRecordChanges,
  InsertAnswerRecordData,
  PracticeSessionRepository,
  PracticeTransaction,
} from './infrastructure/persistence/practice-session.repository';
import { AnswerVisibilityService } from './answer-visibility.service';
import { StatsEventPublisher } from './ports/stats-event.publisher';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus } from './domain/practice-session';
import { AnswerRecord, GradingStatus, MAX_ANSWER_DURATION_SEC } from './domain/answer-record';
import { InspectedAnswer, inspectAnswer, isSubjectiveType } from './domain/answer-content';
import { gradeAnswer, gradeSelfAssessment } from './domain/answer-grading';
import { acceptsMockOverwrite, checkMockWrite } from './domain/mock-exam';
import {
  AnswerPatchDto,
  AnswerResultDto,
  SaveAnswersDto,
  SaveAnswersResultDto,
  SelfAssessmentDto,
} from './dto/save-answers.dto';
import { toAnswerState } from './practice-presenter';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { FilesService } from '../files/files.service';
import { businessDate } from '../papers/domain/business-date';
import { BusinessException } from '../../common/exceptions/business.exception';

/** answered 为写入后 answeredCount 的变化量 */
type RecordAction =
  | { kind: 'none' }
  | { kind: 'update'; changes: AnswerRecordChanges; answered: number }
  | { kind: 'insert'; data: InsertAnswerRecordData; answered: number };

interface WriteOutcome {
  records: Map<string, AnswerRecord>;
  gradedRecordIds: string[];
  skippedQuestionIds: string[];
}

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function sessionNotFound(): NotFoundException {
  return new NotFoundException({ error: 'practiceSessionNotFound' });
}

function canSelfAssess(session: Pick<PracticeSession, 'mode' | 'status'>): boolean {
  if (session.mode === PracticeMode.MEMORIZE) {
    return false;
  }
  if (session.mode === PracticeMode.MOCK) {
    return session.status === PracticeSessionStatus.SUBMITTED;
  }
  return session.status !== PracticeSessionStatus.ABANDONED;
}

/** 作答写入与主观题自评：答完即判模式判分并锁定，模考只落库并允许覆盖 */
@Injectable()
export class PracticeAnswersService {
  private readonly logger = new Logger(PracticeAnswersService.name);

  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly questionsService: QuestionsService,
    private readonly filesService: FilesService,
    private readonly answerVisibilityService: AnswerVisibilityService,
    private readonly statsEventPublisher: StatsEventPublisher,
  ) {}

  async save(userId: number, sessionId: string, dto: SaveAnswersDto): Promise<SaveAnswersResultDto> {
    const session = await this.findOwned(userId, sessionId);
    if (session.mode === PracticeMode.MEMORIZE) {
      throw unprocessable('mode', 'memorizeNotAnswerable');
    }
    const ids = dto.answers.map((patch) => patch.questionId);
    if (new Set(ids).size !== ids.length) {
      throw unprocessable('answers', 'duplicateAnswerQuestion');
    }
    const sessionQuestionIds = new Set(session.questionIds);
    if (ids.some((id) => !sessionQuestionIds.has(id))) {
      throw unprocessable('answers', 'questionNotInSession');
    }
    const questions = new Map((await this.questionsService.findByIds(ids)).map((question) => [question.id, question]));
    const inspected = new Map<string, InspectedAnswer>();
    for (const patch of dto.answers) {
      const result = inspectAnswer(questions.get(patch.questionId)!, patch.answer);
      if (result.kind === 'invalid') {
        throw unprocessable('answers', 'invalidAnswer');
      }
      if (result.kind === 'mismatch') {
        throw unprocessable('answers', 'answerNotMatchQuestion');
      }
      inspected.set(patch.questionId, result);
    }
    await this.assertOwnImages(userId, [...inspected.values()]);

    const isMock = session.mode === PracticeMode.MOCK;
    const patches = [...dto.answers].sort((a, b) => a.questionId.localeCompare(b.questionId));
    const outcome = await this.practiceSessionRepository.transaction(async (tx) => {
      const locked = await this.lockWritable(
        tx,
        userId,
        sessionId,
        ids,
        (current) => current.status === PracticeSessionStatus.IN_PROGRESS,
      );
      const now = new Date();
      let accepts = (_patch: AnswerPatchDto): boolean => true;
      if (isMock) {
        const check = checkMockWrite(locked, dto.deviceId, dto.offline === true, now);
        if ('rejection' in check) {
          throw new BusinessException(check.rejection);
        }
        if (check.phase === 'offlineSync') {
          accepts = (patch) => patch.clientAnsweredAt.getTime() <= locked.deadlineAt!.getTime();
        }
      }
      const existing = new Map(
        (
          await tx.findRecordsForUpdate(
            sessionId,
            patches.map((patch) => patch.questionId),
          )
        ).map((record) => [record.questionId, record]),
      );
      const delta = { answered: 0, correct: 0, durationSec: 0 };
      const result: WriteOutcome = { records: new Map(), gradedRecordIds: [], skippedQuestionIds: [] };
      let filled = false;
      for (const patch of patches) {
        const current = existing.get(patch.questionId);
        if (!accepts(patch)) {
          result.skippedQuestionIds.push(patch.questionId);
          if (current) {
            result.records.set(patch.questionId, current);
          }
          continue;
        }
        const question = questions.get(patch.questionId)!;
        const decideFor = isMock ? this.decideMock.bind(this) : this.decideImmediate.bind(this);
        const decide = (record: AnswerRecord | undefined): RecordAction =>
          decideFor(session, userId, question, patch, inspected.get(patch.questionId)!, dto.deviceId, now, record);
        const record = await this.applyAction(tx, sessionId, patch.questionId, current, decide, (written, action) => {
          delta.answered += action.answered;
          filled ||= action.answered > 0;
          if (isMock || action.answered === 0) {
            return;
          }
          delta.correct += written.isCorrect ? 1 : 0;
          delta.durationSec += written.durationSec;
          if (written.isCorrect !== null) {
            result.gradedRecordIds.push(written.id);
          }
        });
        if (record) {
          result.records.set(patch.questionId, record);
        }
      }
      await tx.adjustSessionCounters(sessionId, delta);
      if (isMock && filled && !locked.isFirstAttempt) {
        await tx.markFirstAttempt(locked);
      }
      return result;
    });

    await this.publishRecords(outcome.gradedRecordIds);
    if (session.mode === PracticeMode.DAILY) {
      await this.publishDailySubjectiveCheckIn(userId, outcome.records, questions);
    }
    return {
      serverNow: new Date(),
      results: await this.toResults(userId, session, ids, questions, outcome.records),
      skippedQuestionIds: outcome.skippedQuestionIds,
    };
  }

  async selfAssess(userId: number, sessionId: string, dto: SelfAssessmentDto): Promise<AnswerResultDto> {
    const session = await this.findOwned(userId, sessionId);
    if (!canSelfAssess(session)) {
      throw new BusinessException('selfAssessmentNotAllowed');
    }
    if (!session.questionIds.includes(dto.questionId)) {
      throw unprocessable('questionId', 'questionNotInSession');
    }
    const [question] = await this.questionsService.findByIds([dto.questionId]);
    if (!question || !isSubjectiveType(question.type)) {
      throw unprocessable('questionId', 'selfAssessmentSubjectiveOnly');
    }

    const outcome = await this.practiceSessionRepository.transaction(async (tx) => {
      const locked = await this.lockWritable(
        tx,
        userId,
        sessionId,
        [dto.questionId],
        canSelfAssess,
        'selfAssessmentNotAllowed',
      );
      const now = new Date();
      const [record] = await tx.findRecordsForUpdate(sessionId, [dto.questionId]);
      if ((record?.answer ?? null) === null || record.gradingStatus === GradingStatus.PENDING) {
        throw new BusinessException('selfAssessmentNotAllowed');
      }
      if (record.selfAssessment !== null) {
        return { record, graded: false, session: locked };
      }
      const isCorrect = gradeSelfAssessment(dto.selfAssessment);
      const updated = await tx.updateRecord(record.id, {
        selfAssessment: dto.selfAssessment,
        isCorrect,
        gradedAt: now,
        statDate: businessDate(now),
      });
      await tx.adjustSessionCounters(sessionId, { answered: 0, correct: isCorrect ? 1 : 0, durationSec: 0 });
      return { record: updated, graded: true, session: locked };
    });

    if (outcome.graded) {
      await this.publishRecords([outcome.record.id]);
    }
    const [result] = await this.toResults(
      userId,
      outcome.session,
      [dto.questionId],
      new Map([[question.id, question]]),
      new Map([[dto.questionId, outcome.record]]),
    );
    return result;
  }

  /** 锁定会话行并校验状态；非模考会话拒绝写入进行中模考的题目 */
  private async lockWritable(
    tx: PracticeTransaction,
    userId: number,
    sessionId: string,
    questionIds: string[],
    isWritable: (session: PracticeSession) => boolean,
    rejection: 'sessionClosed' | 'selfAssessmentNotAllowed' = 'sessionClosed',
  ): Promise<PracticeSession> {
    const locked = await tx.lockSessionForWrite(sessionId);
    if (locked?.userId !== userId) {
      throw sessionNotFound();
    }
    if (!isWritable(locked)) {
      throw new BusinessException(rejection);
    }
    if (locked.mode !== PracticeMode.MOCK) {
      const inMock = await tx.findInProgressMockQuestionIds(userId, questionIds);
      if (inMock.length > 0) {
        throw new BusinessException('questionInMockInProgress', { questionIds: inMock });
      }
    }
    return locked;
  }

  /** 客观题首次作答即判分并锁定，主观题首次作答锁定答案；空答案只更新标记 */
  private decideImmediate(
    session: PracticeSession,
    userId: number,
    question: Question,
    patch: AnswerPatchDto,
    inspected: InspectedAnswer,
    deviceId: string,
    now: Date,
    record: AnswerRecord | undefined,
  ): RecordAction {
    const client = { deviceId, clientSeq: patch.clientSeq, clientAnsweredAt: patch.clientAnsweredAt };
    const mark = patch.markedForReview;
    if (inspected.kind !== 'filled' || (record && record.answer !== null)) {
      if (mark === undefined || record?.markedForReview === mark) {
        return { kind: 'none' };
      }
      if (record) {
        return { kind: 'update', changes: { markedForReview: mark }, answered: 0 };
      }
      if (!mark) {
        return { kind: 'none' };
      }
      return {
        kind: 'insert',
        answered: 0,
        data: {
          ...client,
          sessionId: session.id,
          userId,
          questionId: question.id,
          questionVersion: session.questionVersions[question.id] ?? question.currentVersion,
          answer: null,
          isCorrect: null,
          isPartial: false,
          score: null,
          durationSec: 0,
          markedForReview: true,
          answeredAt: now,
          gradedAt: null,
          statDate: null,
        },
      };
    }

    const grade = gradeAnswer(question.type, question.answer, inspected.answer);
    const graded = grade.isCorrect !== null;
    const fields = {
      ...client,
      questionVersion: session.questionVersions[question.id] ?? question.currentVersion,
      answer: inspected.answer,
      isCorrect: grade.isCorrect,
      isPartial: grade.isPartial,
      score: null,
      durationSec: Math.min(patch.durationSec ?? 0, MAX_ANSWER_DURATION_SEC),
      markedForReview: mark ?? record?.markedForReview ?? false,
      answeredAt: now,
      gradedAt: graded ? now : null,
      statDate: graded ? businessDate(now) : null,
    };
    return record
      ? { kind: 'update', changes: fields, answered: 1 }
      : { kind: 'insert', data: { ...fields, sessionId: session.id, userId, questionId: question.id }, answered: 1 };
  }

  /** 模考只落库不判分；省略答案时保留原答案，空答案为软清空 */
  private decideMock(
    session: PracticeSession,
    userId: number,
    question: Question,
    patch: AnswerPatchDto,
    inspected: InspectedAnswer,
    deviceId: string,
    now: Date,
    record: AnswerRecord | undefined,
  ): RecordAction {
    if (!acceptsMockOverwrite(record, deviceId, patch.clientSeq)) {
      return { kind: 'none' };
    }
    const previous = record?.answer ?? null;
    const answer = patch.answer === undefined ? previous : inspected.kind === 'filled' ? inspected.answer : null;
    const mark = patch.markedForReview ?? record?.markedForReview ?? false;
    const answered = (answer !== null ? 1 : 0) - (previous !== null ? 1 : 0);
    const fields = {
      deviceId,
      clientSeq: patch.clientSeq,
      clientAnsweredAt: patch.clientAnsweredAt,
      answer,
      markedForReview: mark,
      durationSec:
        patch.durationSec === undefined
          ? (record?.durationSec ?? 0)
          : Math.min(patch.durationSec, MAX_ANSWER_DURATION_SEC),
      answeredAt: now,
    };
    if (record) {
      return { kind: 'update', changes: fields, answered };
    }
    if (answer === null && !mark) {
      return { kind: 'none' };
    }
    return {
      kind: 'insert',
      answered,
      data: {
        ...fields,
        sessionId: session.id,
        userId,
        questionId: question.id,
        questionVersion: session.questionVersions[question.id] ?? question.currentVersion,
        isCorrect: null,
        isPartial: false,
        score: null,
        gradedAt: null,
        statDate: null,
      },
    };
  }

  /** 并发插入冲突时重读记录后重新决策 */
  private async applyAction(
    tx: PracticeTransaction,
    sessionId: string,
    questionId: string,
    initial: AnswerRecord | undefined,
    decide: (record: AnswerRecord | undefined) => RecordAction,
    onWritten: (record: AnswerRecord, action: Exclude<RecordAction, { kind: 'none' }>) => void,
  ): Promise<AnswerRecord | undefined> {
    let record = initial;
    for (;;) {
      const action = decide(record);
      if (action.kind === 'none') {
        return record;
      }
      if (action.kind === 'update') {
        const updated = await tx.updateRecord(record!.id, action.changes);
        onWritten(updated, action);
        return updated;
      }
      const inserted = await tx.insertRecord(action.data);
      if (inserted) {
        onWritten(inserted, action);
        return inserted;
      }
      [record] = await tx.findRecordsForUpdate(sessionId, [questionId]);
    }
  }

  private async assertOwnImages(userId: number, answers: InspectedAnswer[]): Promise<void> {
    const ids = [
      ...new Set(
        answers.flatMap((item) =>
          item.kind === 'filled' && Array.isArray(item.answer.imageFileIds)
            ? (item.answer.imageFileIds as string[])
            : [],
        ),
      ),
    ];
    if (ids.length === 0) {
      return;
    }
    const files = await this.filesService.findByIds(ids);
    if (files.length !== ids.length || files.some((file) => file.ownerUserId !== userId)) {
      throw unprocessable('answers', 'answerImageNotOwned');
    }
  }

  /** 每日一练主观题作答不产生统计事件，单独入队打卡判定 */
  private async publishDailySubjectiveCheckIn(
    userId: number,
    records: Map<string, AnswerRecord>,
    questions: Map<string, Question>,
  ): Promise<void> {
    const answeredSubjective = [...records.values()].some(
      (record) => record.answer !== null && isSubjectiveType(questions.get(record.questionId)!.type),
    );
    if (!answeredSubjective) {
      return;
    }
    const date = businessDate();
    await this.statsEventPublisher.publishCheckIn(userId, date).catch((error: unknown) => {
      this.logger.warn(
        `Failed to publish check-in evaluation for user ${userId} on ${date}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async publishRecords(recordIds: string[]): Promise<void> {
    for (const recordId of recordIds) {
      await this.statsEventPublisher.publishRecord(recordId).catch((error: unknown) => {
        this.logger.warn(
          `Failed to publish stats event for record ${recordId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  private async toResults(
    userId: number,
    session: PracticeSession,
    questionIds: string[],
    questions: Map<string, Question>,
    records: Map<string, AnswerRecord>,
  ): Promise<AnswerResultDto[]> {
    const visibilities = await this.answerVisibilityService.evaluate(
      userId,
      questionIds.map((questionId) => ({
        questionId,
        questionType: questions.get(questionId)!.type,
        session,
        record: records.get(questionId),
      })),
      'session',
    );
    const solutionIds = new Set(questionIds.filter((_, index) => visibilities[index].visible));
    const units = solutionIds.size > 0 ? await this.questionsService.findUnitsByQuestionIds([...solutionIds]) : [];
    const { solutions } = await this.questionsService.renderUnits(units, userId, {
      versions: session.questionVersions,
      solutionIds,
    });
    return questionIds.map((questionId, index) =>
      Object.assign(new AnswerResultDto(), {
        questionId,
        answerState: toAnswerState(records.get(questionId), visibilities[index]),
        solution: solutions.get(questionId) ?? null,
        hiddenReason: visibilities[index].hiddenReason,
      }),
    );
  }

  private async findOwned(userId: number, sessionId: string): Promise<PracticeSession> {
    const session = await this.practiceSessionRepository.findById(sessionId);
    if (session?.userId !== userId) {
      throw sessionNotFound();
    }
    return session;
  }
}
