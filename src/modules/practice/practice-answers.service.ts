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

type RecordAction =
  | { kind: 'none' }
  | { kind: 'update'; changes: AnswerRecordChanges; answered: boolean }
  | { kind: 'insert'; data: InsertAnswerRecordData; answered: boolean };

interface WriteOutcome {
  records: Map<string, AnswerRecord>;
  gradedRecordIds: string[];
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

/** 答完即判模式的作答写入与主观题自评 */
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
    if (session.mode === PracticeMode.MOCK) {
      throw unprocessable('mode', 'practiceModeNotSupported');
    }
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

    const now = new Date();
    const patches = [...dto.answers].sort((a, b) => a.questionId.localeCompare(b.questionId));
    const outcome = await this.practiceSessionRepository.transaction(async (tx) => {
      await this.lockWritable(
        tx,
        userId,
        sessionId,
        ids,
        (locked) => locked.status === PracticeSessionStatus.IN_PROGRESS,
      );
      const existing = new Map(
        (
          await tx.findRecordsForUpdate(
            sessionId,
            patches.map((patch) => patch.questionId),
          )
        ).map((record) => [record.questionId, record]),
      );
      const delta = { answered: 0, correct: 0, durationSec: 0 };
      const result: WriteOutcome = { records: new Map(), gradedRecordIds: [] };
      for (const patch of patches) {
        const question = questions.get(patch.questionId)!;
        const decide = (record: AnswerRecord | undefined): RecordAction =>
          this.decideImmediate(
            session,
            userId,
            question,
            patch,
            inspected.get(patch.questionId)!,
            dto.deviceId,
            now,
            record,
          );
        const record = await this.applyAction(
          tx,
          sessionId,
          patch.questionId,
          existing.get(patch.questionId),
          decide,
          (written, action) => {
            if (!action.answered) {
              return;
            }
            delta.answered += 1;
            delta.correct += written.isCorrect ? 1 : 0;
            delta.durationSec += written.durationSec;
            if (written.isCorrect !== null) {
              result.gradedRecordIds.push(written.id);
            }
          },
        );
        if (record) {
          result.records.set(patch.questionId, record);
        }
      }
      await tx.adjustSessionCounters(sessionId, delta);
      return result;
    });

    await this.publishRecords(outcome.gradedRecordIds);
    return {
      serverNow: new Date(),
      results: await this.toResults(userId, session, ids, questions, outcome.records),
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

    const now = new Date();
    const outcome = await this.practiceSessionRepository.transaction(async (tx) => {
      const locked = await this.lockWritable(
        tx,
        userId,
        sessionId,
        [dto.questionId],
        canSelfAssess,
        'selfAssessmentNotAllowed',
      );
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
        return { kind: 'update', changes: { markedForReview: mark }, answered: false };
      }
      if (!mark) {
        return { kind: 'none' };
      }
      return {
        kind: 'insert',
        answered: false,
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
      ? { kind: 'update', changes: fields, answered: true }
      : { kind: 'insert', data: { ...fields, sessionId: session.id, userId, questionId: question.id }, answered: true };
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
