import { Feedback, FeedbackStatus, FeedbackType } from '../../domain/feedback';
import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { TransactionHandle } from '../../../../common/database/transaction-handle';

export interface FeedbackFilter {
  userId?: number;
  types: FeedbackType[];
  status?: FeedbackStatus;
  questionId?: string;
}

export type FeedbackChanges = Partial<Pick<Feedback, 'status' | 'reply' | 'errataId'>>;

export abstract class FeedbackRepository {
  abstract create(data: Omit<Feedback, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Feedback>;

  abstract findById(id: Feedback['id']): Promise<NullableType<Feedback>>;

  abstract findByIds(ids: Feedback['id'][]): Promise<Feedback[]>;

  abstract findManyWithPagination({
    userId,
    type,
    status,
    paginationOptions,
  }: {
    userId: number;
    type?: FeedbackType;
    status?: FeedbackStatus;
    paginationOptions: IPaginationOptions;
  }): Promise<Feedback[]>;

  abstract countByUserId(userId: number, filters?: { type?: FeedbackType; status?: FeedbackStatus }): Promise<number>;

  /** 按创建时间倒序 */
  abstract findPage(
    filter: FeedbackFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Feedback[]; total: number }>;

  abstract update(id: Feedback['id'], changes: FeedbackChanges): Promise<NullableType<Feedback>>;

  /** 事务内把该题的题目纠错单关联到勘误，待处理的置为处理中，返回关联数 */
  abstract linkErrata(
    handle: TransactionHandle,
    ids: Feedback['id'][],
    questionId: string,
    errataId: string,
  ): Promise<number>;

  /** 关联该勘误且待处理或处理中的纠错单置为已解决，回复为空时写入 reply，返回更新数 */
  abstract resolveByErrata(errataId: string, reply: string): Promise<number>;

  /** 该用户的反馈与纠错单解除用户关联并清空联系方式与图片 */
  abstract anonymizeByUser(userId: number): Promise<void>;
}
