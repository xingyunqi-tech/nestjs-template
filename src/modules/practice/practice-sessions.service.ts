import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CreatePracticeSessionData,
  PracticeSessionRepository,
} from './infrastructure/persistence/practice-session.repository';
import { PickResult, QuestionPickerService } from './question-picker.service';
import { AnswerVisibilityService } from './answer-visibility.service';
import { MockExamService } from './mock-exam.service';
import { PracticeMode } from './domain/practice-mode';
import { PracticeScope, PracticeSession, PracticeSessionStatus, SubmitType } from './domain/practice-session';
import { AnswerRecord } from './domain/answer-record';
import { alignSegment } from './domain/session-segment';
import { CreatePracticeSessionDto, PRACTICE_SESSION_LIMITS } from './dto/create-practice-session.dto';
import {
  AnswerCardItemDto,
  CreatePracticeSessionResultDto,
  PracticeSessionDetailDto,
  PracticeSessionDto,
  QueryPracticeSessionsDto,
} from './dto/practice-session.dto';
import {
  PracticeQuestionDto,
  PracticeQuestionUnitDto,
  QuerySessionQuestionsDto,
  SEGMENT_LIMITS,
  SessionQuestionsDto,
} from './dto/practice-question.dto';
import { toAnswerState, toPracticeSessionDto } from './practice-presenter';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { QuestionsService } from '../questions/questions.service';
import { PublicQuestionDto } from '../questions/dto/public-question.dto';
import { businessDate } from '../papers/domain/business-date';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IPaginationOptions } from '../../common/types/pagination-options';

const ONGOING_LIMIT = 20;

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function sessionNotFound(): NotFoundException {
  return new NotFoundException({ error: 'practiceSessionNotFound' });
}

@Injectable()
export class PracticeSessionsService {
  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly questionPickerService: QuestionPickerService,
    private readonly answerVisibilityService: AnswerVisibilityService,
    private readonly subjectsService: SubjectsService,
    private readonly knowledgePointsService: KnowledgePointsService,
    private readonly questionsService: QuestionsService,
    private readonly mockExamService: MockExamService,
  ) {}

  /** 每日一练每用户每科目每天一个、模考每用户每试卷一个进行中，重复进入返回同一会话 */
  async create(userId: number, dto: CreatePracticeSessionDto): Promise<CreatePracticeSessionResultDto> {
    if (dto.mode === PracticeMode.FAVORITE) {
      throw unprocessable('mode', 'practiceModeNotSupported');
    }
    if (dto.mode === PracticeMode.MOCK && !dto.paperId) {
      throw unprocessable('paperId', 'paperRequired');
    }
    if (dto.mode !== PracticeMode.MOCK && dto.paperId) {
      throw unprocessable('paperId', 'paperNotAllowed');
    }
    await this.subjectsService.getPublishedSubject(dto.subjectId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? unprocessable('subjectId', 'subjectNotFound') : error;
    });
    if (dto.mode === PracticeMode.MOCK) {
      const entry = await this.mockExamService.enter(userId, dto.subjectId, dto.paperId!, dto.deviceId);
      const detail = await this.toDetail(userId, entry.session, new CreatePracticeSessionResultDto());
      detail.insufficient = false;
      detail.isActiveDevice = entry.isActiveDevice;
      return detail;
    }
    const scope = await this.resolveScope(dto);
    const count = dto.count ?? PRACTICE_SESSION_LIMITS.defaultCount;
    if (dto.mode === PracticeMode.DAILY) {
      return this.enterDaily(userId, dto.subjectId);
    }

    const picked = await this.questionPickerService.pick({
      userId,
      subjectId: dto.subjectId,
      mode: dto.mode,
      scope,
      count,
    });
    if (picked.questionIds.length === 0) {
      throw new BusinessException('noQuestionsAvailable');
    }
    const session = await this.practiceSessionRepository.create(
      this.sessionData(userId, dto.subjectId, dto.mode, scope, null, picked),
    );
    const detail = await this.toDetail(userId, session, new CreatePracticeSessionResultDto());
    detail.insufficient = picked.insufficient;
    detail.isActiveDevice = true;
    return detail;
  }

  /** 已有当日会话时直接返回；创建与重新生成题组按科目与日期互斥 */
  private async enterDaily(userId: number, subjectId: string): Promise<CreatePracticeSessionResultDto> {
    const key = { userId, subjectId, dailyDate: businessDate() };
    const session =
      (await this.practiceSessionRepository.findDaily(key)) ??
      (await this.practiceSessionRepository.createDaily(key, async () => {
        const picked = await this.questionPickerService.pick({
          userId,
          subjectId,
          mode: PracticeMode.DAILY,
          scope: {},
          count: 0,
          dailyDate: key.dailyDate,
        });
        return picked.questionIds.length === 0
          ? null
          : this.sessionData(userId, subjectId, PracticeMode.DAILY, {}, key.dailyDate, picked);
      }));
    if (!session) {
      throw new BusinessException('noQuestionsAvailable');
    }
    const detail = await this.toDetail(userId, session, new CreatePracticeSessionResultDto());
    detail.insufficient = false;
    detail.isActiveDevice = true;
    return detail;
  }

  private sessionData(
    userId: number,
    subjectId: string,
    mode: PracticeMode,
    scope: PracticeScope,
    dailyDate: string | null,
    picked: Pick<PickResult, 'questionIds' | 'questionVersions'>,
  ): CreatePracticeSessionData {
    return {
      userId,
      subjectId,
      mode,
      paperId: null,
      dailyDate,
      scope,
      questionIds: picked.questionIds,
      questionVersions: picked.questionVersions,
      activeDeviceId: null,
      deadlineAt: null,
      autoSubmitAt: null,
      scoringScheme: null,
      totalScore: null,
    };
  }

  async getDetail(userId: number, sessionId: string): Promise<PracticeSessionDetailDto> {
    return this.toDetail(userId, await this.findOwned(userId, sessionId), new PracticeSessionDetailDto());
  }

  /** 分段边界对齐材料；按答案可见性附带答案与解析 */
  async getQuestions(userId: number, sessionId: string, query: QuerySessionQuestionsDto): Promise<SessionQuestionsDto> {
    const session = await this.findOwned(userId, sessionId);
    const summaries = new Map(
      (await this.questionsService.findSummariesByIds(session.questionIds)).map((summary) => [summary.id, summary]),
    );
    const groupKeys = session.questionIds.map((id) => summaries.get(id)?.parentId ?? id);
    const { start, end } = alignSegment(groupKeys, query.from ?? 0, query.size ?? SEGMENT_LIMITS.defaultSize);
    const segmentIds = session.questionIds.slice(start, end);

    const [units, records] = await Promise.all([
      this.questionsService.findUnitsByQuestionIds(segmentIds),
      this.practiceSessionRepository.findRecords(session.id, segmentIds),
    ]);
    const recordMap = new Map(records.map((record) => [record.questionId, record]));
    const questions = units.flatMap((unit) => unit.questions);
    const visibilities = await this.answerVisibilityService.evaluate(
      userId,
      questions.map((question) => ({
        questionId: question.id,
        questionType: question.type,
        session,
        record: recordMap.get(question.id),
      })),
    );
    const visibility = new Map(questions.map((question, index) => [question.id, visibilities[index]]));
    const rendered = await this.questionsService.renderUnits(units, userId, {
      versions: session.questionVersions,
      solutionIds: new Set(questions.filter((question) => visibility.get(question.id)!.visible).map((q) => q.id)),
    });

    const toPracticeQuestion = <T extends PracticeQuestionDto>(dto: PublicQuestionDto, target: T): T => {
      const state = visibility.get(dto.id);
      return Object.assign(target, dto, {
        answerState: state ? toAnswerState(recordMap.get(dto.id), state) : null,
        solution: rendered.solutions.get(dto.id) ?? null,
        hiddenReason: state?.hiddenReason ?? null,
      });
    };
    return {
      from: start,
      size: questions.length,
      total: session.questionIds.length,
      units: rendered.units.map((unit) => {
        const { children, ...root } = unit;
        const dto = toPracticeQuestion(root, new PracticeQuestionUnitDto());
        if (children) {
          dto.children = children.map((child) => toPracticeQuestion(child, new PracticeQuestionDto()));
        }
        return dto;
      }),
    };
  }

  async updateProgress(userId: number, sessionId: string, lastIndex: number): Promise<PracticeSessionDto> {
    const session = await this.findOwned(userId, sessionId);
    if (lastIndex >= session.questionIds.length) {
      throw unprocessable('lastIndex', 'invalidLastIndex');
    }
    await this.practiceSessionRepository.updateProgress(sessionId, lastIndex);
    return toPracticeSessionDto((await this.practiceSessionRepository.findById(sessionId))!);
  }

  /** 已结束的会话直接返回当前结果 */
  async submit(userId: number, sessionId: string): Promise<PracticeSessionDetailDto> {
    const session = await this.findOwned(userId, sessionId);
    if (session.mode === PracticeMode.DAILY) {
      throw new ConflictException({ error: 'dailySessionCannotFinish' });
    }
    if (session.mode === PracticeMode.MOCK) {
      await this.mockExamService.submit(sessionId, true);
    } else {
      await this.practiceSessionRepository.closeInProgress(
        sessionId,
        PracticeSessionStatus.SUBMITTED,
        SubmitType.MANUAL,
      );
    }
    return this.getDetail(userId, sessionId);
  }

  async abandon(userId: number, sessionId: string): Promise<PracticeSessionDetailDto> {
    const session = await this.findOwned(userId, sessionId);
    if (session.mode === PracticeMode.DAILY) {
      throw new ConflictException({ error: 'dailySessionCannotAbandon' });
    }
    await this.practiceSessionRepository.closeInProgress(sessionId, PracticeSessionStatus.ABANDONED, null);
    return this.getDetail(userId, sessionId);
  }

  async findHistory(
    userId: number,
    query: QueryPracticeSessionsDto,
  ): Promise<{ data: PracticeSessionDto[]; total: number; paginationOptions: IPaginationOptions }> {
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.practiceSessionRepository.findManyWithPaginationAndCount(
      { userId, mode: query.mode, status: query.status },
      paginationOptions,
    );
    return { data: data.map((session) => toPracticeSessionDto(session)), total, paginationOptions };
  }

  async findOngoing(userId: number): Promise<PracticeSessionDto[]> {
    const sessions = await this.practiceSessionRepository.findOngoing(userId, ONGOING_LIMIT);
    return sessions.map((session) => toPracticeSessionDto(session));
  }

  private async resolveScope(dto: CreatePracticeSessionDto): Promise<PracticeScope> {
    const { knowledgePointId, questionType, fromSessionId } = dto.scope ?? {};
    switch (dto.mode) {
      case PracticeMode.CHAPTER:
        if (!knowledgePointId) {
          throw unprocessable('scope', 'knowledgePointRequired');
        }
        await this.assertKnowledgePoint(dto.subjectId, knowledgePointId);
        return { knowledgePointId };
      case PracticeMode.TYPE:
        if (!questionType) {
          throw unprocessable('scope', 'questionTypeRequired');
        }
        return { questionType };
      case PracticeMode.MEMORIZE:
        if (!knowledgePointId && !questionType) {
          throw unprocessable('scope', 'memorizeScopeRequired');
        }
        if (knowledgePointId) {
          await this.assertKnowledgePoint(dto.subjectId, knowledgePointId);
        }
        return { ...(knowledgePointId && { knowledgePointId }), ...(questionType && { questionType }) };
      case PracticeMode.WRONG:
        return fromSessionId ? { fromSessionId } : {};
      default:
        return {};
    }
  }

  private async assertKnowledgePoint(subjectId: string, knowledgePointId: string): Promise<void> {
    const point = await this.knowledgePointsService.findById(knowledgePointId).catch((error: unknown) => {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    });
    if (point?.subjectId !== subjectId) {
      throw unprocessable('scope', 'invalidKnowledgePoint');
    }
  }

  private async toDetail<T extends PracticeSessionDetailDto>(
    userId: number,
    session: PracticeSession,
    target: T,
  ): Promise<T> {
    const [summaries, records] = await Promise.all([
      this.questionsService.findSummariesByIds(session.questionIds),
      this.practiceSessionRepository.findRecords(session.id),
    ]);
    const summaryMap = new Map(summaries.map((summary) => [summary.id, summary]));
    const recordMap = new Map<string, AnswerRecord>(records.map((record) => [record.questionId, record]));
    const known = session.questionIds.filter((id) => summaryMap.has(id));
    const visibilities = await this.answerVisibilityService.evaluate(
      userId,
      known.map((questionId) => ({
        questionId,
        questionType: summaryMap.get(questionId)!.type,
        session,
        record: recordMap.get(questionId),
      })),
    );
    const visibility = new Map(known.map((id, index) => [id, visibilities[index]]));
    const dto = toPracticeSessionDto(session, target);
    dto.serverNow = new Date();
    dto.card = session.questionIds.flatMap((questionId, index) => {
      const summary = summaryMap.get(questionId);
      if (!summary) {
        return [];
      }
      const state = toAnswerState(recordMap.get(questionId), visibility.get(questionId)!);
      return Object.assign(new AnswerCardItemDto(), {
        index,
        questionId,
        materialId: summary.parentId,
        type: summary.type,
        answered: (state?.answer ?? null) !== null,
        isCorrect: state?.isCorrect ?? null,
        isPartial: state?.isPartial ?? false,
        selfAssessment: state?.selfAssessment ?? null,
        markedForReview: state?.markedForReview ?? false,
        hiddenReason: visibility.get(questionId)!.hiddenReason,
      });
    });
    return dto;
  }

  private async findOwned(userId: number, sessionId: string): Promise<PracticeSession> {
    const session = await this.practiceSessionRepository.findById(sessionId);
    if (session?.userId !== userId) {
      throw sessionNotFound();
    }
    return session;
  }
}
