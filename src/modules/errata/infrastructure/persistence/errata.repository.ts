import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { Errata, ErrataStatus } from '../../domain/errata';

/** 该题已有未完成的勘误 */
export class ErrataConflictError extends Error {}

export type CreateErrataData = Pick<
  Errata,
  'questionId' | 'fromVersion' | 'toVersion' | 'answerChanged' | 'reply' | 'createdBy'
>;

export interface ErrataFilter {
  status?: ErrataStatus;
  questionId?: string;
}

export abstract class ErrataRepository {
  /** 同一题已有未完成的勘误时抛出 ErrataConflictError */
  abstract insert(handle: TransactionHandle, data: CreateErrataData): Promise<Errata>;

  abstract findById(id: Errata['id']): Promise<NullableType<Errata>>;

  abstract findActiveByQuestion(questionId: string): Promise<NullableType<Errata>>;

  /** 按创建时间倒序 */
  abstract findManyWithPaginationAndCount(
    filter: ErrataFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Errata[]; total: number }>;

  /** 超过 staleMs 未更新的 PENDING 与 RUNNING 任务，按 updatedAt 升序 */
  abstract findStaleActive(staleMs: number, limit: number): Promise<Errata[]>;

  /** 任务为 PENDING 或 RUNNING 且超过 staleMs 未更新 */
  abstract isStaleActive(id: Errata['id'], staleMs: number): Promise<boolean>;

  /** PENDING 或 RUNNING 的任务置为 RUNNING 并返回，其余返回 null */
  abstract start(id: Errata['id']): Promise<NullableType<Errata>>;

  abstract setAffectedUsers(id: Errata['id'], affectedUsers: number): Promise<void>;

  /** 刷新 updatedAt */
  abstract touch(id: Errata['id']): Promise<void>;

  /** 记录用户已处理并累加已处理数；同一用户只计一次 */
  abstract markUserProcessed(handle: TransactionHandle, id: Errata['id'], userId: number): Promise<void>;

  /** 事务内把至多 limit 个未通知的已处理用户置为已通知，返回置为已通知的数量与其中未注销的用户 */
  abstract claimNoticeUsers(
    handle: TransactionHandle,
    id: Errata['id'],
    limit: number,
  ): Promise<{ claimed: number; activeUserIds: number[] }>;

  abstract finish(id: Errata['id']): Promise<NullableType<Errata>>;

  abstract fail(id: Errata['id'], reason: string): Promise<void>;

  /** FAILED 的任务置回 PENDING，返回是否成功；同一题已有未完成的勘误时抛出 ErrataConflictError */
  abstract reopen(id: Errata['id']): Promise<boolean>;

  /** 在事务内执行；死锁时短暂退避后整体重试 */
  abstract transaction<T>(work: (handle: TransactionHandle) => Promise<T>): Promise<T>;

  abstract removeUserLinks(userId: number): Promise<void>;
}
