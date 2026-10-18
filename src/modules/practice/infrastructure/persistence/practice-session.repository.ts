import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { PracticeMode } from '../../domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, SubmitType } from '../../domain/practice-session';
import { AnswerRecord } from '../../domain/answer-record';

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
}

export abstract class PracticeSessionRepository {
  abstract create(data: CreatePracticeSessionData): Promise<PracticeSession>;

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
  abstract findOngoing(userId: number, limit: number): Promise<PracticeSession[]>;

  abstract findInProgressMockQuestionIds(userId: number): Promise<string[]>;

  /** 用户在科目内作答过（答案非空）的题目所属出题单位 id */
  abstract findAnsweredRootIds(userId: number, subjectId: string): Promise<string[]>;

  /** 会话中判错的题目（含部分正确与自评不会），按会话出题顺序 */
  abstract findWrongQuestionIds(session: PracticeSession): Promise<string[]>;

  /** questionIds 中出现在该用户任一会话里的题目 */
  abstract findQuestionIdsInUserSessions(userId: number, questionIds: string[]): Promise<string[]>;

  abstract updateProgress(id: PracticeSession['id'], lastIndex: number): Promise<void>;

  /** 仅当状态为 IN_PROGRESS 时更新，返回是否更新 */
  abstract closeInProgress(
    id: PracticeSession['id'],
    status: PracticeSessionStatus.SUBMITTED | PracticeSessionStatus.ABANDONED,
    submitType: SubmitType | null,
  ): Promise<boolean>;

  /** 将 lastActiveAt 早于 before 的进行中会话置为 ABANDONED，跳过 excludedModes，返回处理数 */
  abstract abandonInactive(before: Date, excludedModes: PracticeMode[], batchSize: number): Promise<number>;

  /** 在事务内执行；死锁时短暂退避后整体重试 */
  abstract transaction<T>(work: (tx: PracticeTransaction) => Promise<T>): Promise<T>;
}
