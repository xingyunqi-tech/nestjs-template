import { NullableType } from '../../../../common/types/nullable.type';
import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { StatsRecord } from '../../domain/stats-record';

export interface StatsEventTransaction {
  readonly handle: TransactionHandle;

  /** 以事务级 advisory 锁串行同一用户的统计写入 */
  lockRecordUser(id: StatsRecord['id']): Promise<void>;

  /** 抢占记录，返回是否抢占成功 */
  claimRecord(id: StatsRecord['id']): Promise<boolean>;

  findRecord(id: StatsRecord['id']): Promise<NullableType<StatsRecord>>;

  /** 该用户此前未计入过该题时标记首次作答并累加题目全站统计，返回是否标记；唯一索引冲突视为非首次 */
  markFirstForQuestion(record: Pick<StatsRecord, 'id' | 'userId' | 'questionId' | 'isCorrect'>): Promise<boolean>;
}

export interface PendingRecordCursor {
  /** 数据库原样精度的 gradedAt */
  gradedAt: string;
  id: string;
}

export abstract class StatsEventRepository {
  /** 事务内取得该用户统计写入的 advisory 锁，与统计事件处理器互斥 */
  abstract lockUser(handle: TransactionHandle, userId: number): Promise<void>;

  abstract findRecordUserId(id: StatsRecord['id']): Promise<NullableType<number>>;

  /** 会话内已判分且未计入统计的记录 */
  abstract findPendingSessionRecords(sessionId: string): Promise<Pick<StatsRecord, 'id' | 'userId'>[]>;

  /** gradedAt 早于 gradedBefore 且未计入统计的已判分记录，按 (gradedAt, id) 升序取 after 之后的 limit 条；userIds 限定用户 */
  abstract findStalePendingRecords(
    gradedBefore: Date,
    after: PendingRecordCursor | null,
    limit: number,
    userIds?: number[],
  ): Promise<PendingRecordCursor[]>;

  /** 在事务内执行；死锁时短暂退避后整体重试 */
  abstract transaction<T>(work: (tx: StatsEventTransaction) => Promise<T>): Promise<T>;
}
