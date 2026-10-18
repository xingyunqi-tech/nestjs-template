import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { PracticeMode } from '../../domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, ScoringScheme, SubmitType } from '../../domain/practice-session';
import { AnswerRecord } from '../../domain/answer-record';
import { SessionAnswerContext } from '../../domain/answer-visibility';

export type CreatePracticeSessionData = Pick<
  PracticeSession,
  | 'userId'
  | 'subjectId'
  | 'mode'
  | 'paperId'
  | 'dailyDate'
  | 'scope'
  | 'questionIds'
  | 'questionVersions'
  | 'activeDeviceId'
  | 'deadlineAt'
  | 'autoSubmitAt'
  | 'scoringScheme'
  | 'totalScore'
>;

type AnswerRecordFields = Pick<
  AnswerRecord,
  | 'questionVersion'
  | 'answer'
  | 'isCorrect'
  | 'isPartial'
  | 'score'
  | 'durationSec'
  | 'markedForReview'
  | 'deviceId'
  | 'clientSeq'
  | 'clientAnsweredAt'
  | 'answeredAt'
  | 'gradedAt'
  | 'statDate'
>;

export type InsertAnswerRecordData = AnswerRecordFields & Pick<AnswerRecord, 'sessionId' | 'userId' | 'questionId'>;

export type AnswerRecordChanges = Partial<AnswerRecordFields & Pick<AnswerRecord, 'selfAssessment'>>;

/** 创建模考时试卷已不存在 */
export class MockPaperMissingError extends Error {}

export type CreateMockSessionData = CreatePracticeSessionData & Pick<PracticeSession, 'startedAt'>;

export interface RecordGrade {
  id: AnswerRecord['id'];
  isCorrect: boolean;
  isPartial: boolean;
  score: number;
}

export type MockSubmission =
  | {
      status: PracticeSessionStatus.SUBMITTED;
      submitType: SubmitType;
      submittedAt: Date;
      durationSec: number;
      score: number;
      correctCount: number;
      scoringScheme: ScoringScheme;
      totalScore: number;
    }
  | { status: PracticeSessionStatus.ABANDONED };

export interface PercentileSample {
  /** 得分低于给定分数的样本数 */
  below: number;
  total: number;
}

export type DailySessionKey = { userId: number; subjectId: string; dailyDate: string };

export interface SessionCounterDelta {
  answered: number;
  correct: number;
  durationSec: number;
}

export interface PracticeSessionFilter {
  userId: number;
  mode?: PracticeMode;
  status?: PracticeSessionStatus;
}

export interface PracticeTransaction {
  /** SELECT ... FOR NO KEY UPDATE：同一会话的写入串行，并与交卷、放弃的条件更新互斥 */
  lockSessionForWrite(id: PracticeSession['id']): Promise<NullableType<PracticeSession>>;

  /** questionIds 中位于该用户进行中模考的题目 */
  findInProgressMockQuestionIds(userId: number, questionIds: string[]): Promise<string[]>;

  /** 按 questionId 顺序加行锁 */
  findRecordsForUpdate(sessionId: PracticeSession['id'], questionIds: string[]): Promise<AnswerRecord[]>;

  /** (sessionId, questionId) 已存在时返回 null */
  insertRecord(data: InsertAnswerRecordData): Promise<NullableType<AnswerRecord>>;

  updateRecord(id: AnswerRecord['id'], changes: AnswerRecordChanges): Promise<AnswerRecord>;

  /** 原子增减计数并刷新 lastActiveAt */
  adjustSessionCounters(id: PracticeSession['id'], delta: SessionCounterDelta): Promise<void>;

  /** 该用户在该试卷上没有首次作答会话时标记本会话并自增试卷参考人数，返回是否标记；并发冲突视为未标记 */
  markFirstAttempt(session: Pick<PracticeSession, 'id' | 'userId' | 'paperId'>): Promise<boolean>;

  /** 写入判分结果；gradedAt 与 statDate 取交卷时间 */
  gradeRecords(grades: RecordGrade[], gradedAt: Date, statDate: string): Promise<void>;

  setActiveDevice(id: PracticeSession['id'], deviceId: string): Promise<void>;

  /** 仅当状态为 IN_PROGRESS 时写入交卷结果，返回是否更新 */
  closeMock(id: PracticeSession['id'], submission: MockSubmission): Promise<boolean>;
}

export abstract class PracticeSessionRepository {
  abstract create(data: CreatePracticeSessionData): Promise<PracticeSession>;

  /** 同一用户同一试卷已有进行中的模考时不插入并返回 null；试卷不存在时抛出 MockPaperMissingError */
  abstract insertMockIfAbsent(data: CreateMockSessionData): Promise<NullableType<PracticeSession>>;

  abstract findInProgressMock(userId: number, paperId: string): Promise<NullableType<PracticeSession>>;

  /** autoSubmitAt 不晚于 now 的进行中模考 */
  abstract findDueMockIds(now: Date, limit: number): Promise<string[]>;

  /** 相同计分口径下其他用户首次作答且已交卷的成绩 */
  abstract findPercentileSample(
    session: Pick<PracticeSession, 'userId' | 'paperId' | 'scoringScheme'>,
    score: number,
  ): Promise<PercentileSample>;

  abstract findDaily(key: DailySessionKey): Promise<NullableType<PracticeSession>>;

  /** 持有科目与日期的锁：已有会话时直接返回，否则以 build 的结果创建；build 返回 null 时不创建 */
  abstract createDaily(
    key: DailySessionKey,
    build: () => Promise<CreatePracticeSessionData | null>,
  ): Promise<NullableType<PracticeSession>>;

  abstract findById(id: PracticeSession['id']): Promise<NullableType<PracticeSession>>;

  abstract findRecords(sessionId: PracticeSession['id'], questionIds?: string[]): Promise<AnswerRecord[]>;

  /** 按开始时间倒序 */
  abstract findManyWithPaginationAndCount(
    filter: PracticeSessionFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: PracticeSession[]; total: number }>;

  /** 进行中的会话，按最近活跃倒序 */
  abstract findOngoing(userId: number, limit: number, excludeModes: PracticeMode[]): Promise<PracticeSession[]>;

  abstract findInProgressMockQuestionIds(userId: number): Promise<string[]>;

  /** 会话中判错的题目（含部分正确与自评不会），按会话出题顺序 */
  abstract findWrongQuestionIds(session: PracticeSession): Promise<string[]>;

  /** questionIds 中出现在该用户任一会话里的题目 */
  abstract findQuestionIdsInUserSessions(userId: number, questionIds: string[]): Promise<string[]>;

  /** 该用户含此题的会话中背题、已交卷模考或已作答的会话状态与作答 */
  abstract findSessionAnswerContexts(
    userId: number,
    questionId: string,
  ): Promise<Required<Pick<SessionAnswerContext, 'session' | 'record'>>[]>;

  abstract updateProgress(id: PracticeSession['id'], lastIndex: number): Promise<void>;

  /** 仅当状态为 IN_PROGRESS 时更新，返回是否更新 */
  abstract closeInProgress(
    id: PracticeSession['id'],
    status: PracticeSessionStatus.SUBMITTED | PracticeSessionStatus.ABANDONED,
    submitType: SubmitType | null,
  ): Promise<boolean>;

  /** 将 lastActiveAt 早于 before 的进行中会话置为 ABANDONED，跳过 excludedModes，返回处理数 */
  abstract abandonInactive(before: Date, excludedModes: PracticeMode[], batchSize: number): Promise<number>;

  abstract findInProgressMockIds(userId: number): Promise<string[]>;

  /** 删除该用户的全部会话，作答记录随会话级联删除 */
  abstract removeByUser(userId: number): Promise<void>;

  /** 在事务内执行；死锁时短暂退避后整体重试 */
  abstract transaction<T>(work: (tx: PracticeTransaction) => Promise<T>): Promise<T>;
}
