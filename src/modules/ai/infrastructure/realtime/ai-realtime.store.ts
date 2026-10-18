import { AiStreamEntry, AiStreamEventName } from '../../domain/ai-stream-event';

export const aiQuotaKey = (userId: number, date: string, kind: string): string => `ai:quota:${userId}:${date}:${kind}`;

export const aiCostKey = (date: string): string => `ai:cost:${date}`;

export const aiMessageStreamKey = (messageId: string): string => `ai:msg:${messageId}`;

export const AI_STOP_CHANNEL = 'ai:stop';

/** AI 的计数、消息事件流与停止广播 */
export abstract class AiRealtimeStore {
  /** 加 1 并返回新值；key 没有过期时间时设置 ttlSeconds */
  abstract increment(key: string, ttlSeconds: number): Promise<number>;

  /** 大于 0 时减 1 */
  abstract decrement(key: string): Promise<void>;

  /** 累加并返回新值；key 没有过期时间时设置 ttlSeconds */
  abstract incrementFloat(key: string, amount: number, ttlSeconds: number): Promise<number>;

  /** 不存在时为 0 */
  abstract getNumber(key: string): Promise<number>;

  /** 追加事件并刷新过期时间，返回条目 id */
  abstract append(
    key: string,
    event: AiStreamEventName,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<string>;

  /** afterId 之后至多 count 条，afterId 为 0 时从头读取；流不存在时返回 null */
  abstract read(key: string, afterId: string, count: number): Promise<(AiStreamEntry & { id: string })[] | null>;

  abstract publish(channel: string, message: string): Promise<void>;

  abstract subscribe(channel: string, handler: (message: string) => void): Promise<void>;
}
