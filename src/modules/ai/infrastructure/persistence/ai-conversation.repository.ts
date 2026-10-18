import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { AiConversation } from '../../domain/ai-conversation';

export type CreateAiConversationData = Pick<
  AiConversation,
  'userId' | 'title' | 'contextType' | 'contextId' | 'contextVersion'
>;

export abstract class AiConversationRepository {
  /** 同一用户同一上下文（类型、id、版本）已有会话时返回已有会话 */
  abstract findOrCreate(data: CreateAiConversationData): Promise<AiConversation>;

  abstract findById(id: AiConversation['id']): Promise<NullableType<AiConversation>>;

  /** 按更新时间倒序 */
  abstract findManyByUser(
    userId: number,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: AiConversation[]; total: number }>;

  /** 消息随会话级联删除 */
  abstract remove(id: AiConversation['id']): Promise<void>;

  /** 仅当摘要位置仍为 expectedUpToMessageId 时更新，返回是否更新 */
  abstract updateSummary(
    id: AiConversation['id'],
    expectedUpToMessageId: string | null,
    summary: string,
    upToMessageId: string,
  ): Promise<boolean>;
}
