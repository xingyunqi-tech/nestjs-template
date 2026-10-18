import { NullableType } from '../../../../common/types/nullable.type';
import { AiMessage } from '../../domain/ai-message';

/** 会话已有生成中的回答 */
export class AiMessageInProgressError extends Error {}

export interface CreateAiExchangeData {
  conversationId: string;
  content: string;
  quotaDate: string;
  /** 会话尚无消息时写入的标题 */
  title: string;
}

export type AiMessageResult = Pick<AiMessage, 'content' | 'reasoning' | 'suggestions' | 'status' | 'usage'>;

export abstract class AiMessageRepository {
  abstract findById(id: AiMessage['id']): Promise<NullableType<AiMessage>>;

  /** 消息所属会话属于该用户时返回 */
  abstract findOwned(userId: number, id: AiMessage['id']): Promise<NullableType<AiMessage>>;

  /** 早于 beforeId 的最近 limit 条，按时间升序 */
  abstract findPage(
    conversationId: string,
    options: { beforeId?: string; limit: number },
  ): Promise<{ data: AiMessage[]; hasMore: boolean }>;

  /** afterMessageId 之后最近的 limit 条，按时间升序；afterMessageId 为空时从头开始 */
  abstract findAfter(conversationId: string, afterMessageId: string | null, limit: number): Promise<AiMessage[]>;

  abstract findStreamingIds(conversationId: string): Promise<string[]>;

  /**
   * 锁定会话后写入用户消息与生成中的回答，会话尚无消息时写入标题；会话不存在时返回 null
   * @throws AiMessageInProgressError 会话已有生成中的回答
   */
  abstract createExchange(data: CreateAiExchangeData): Promise<NullableType<{ user: AiMessage; assistant: AiMessage }>>;

  /** 仅当状态为 STREAMING 时写入结果，返回是否更新 */
  abstract finish(id: AiMessage['id'], result: AiMessageResult): Promise<boolean>;
}
