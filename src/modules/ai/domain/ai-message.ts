export enum AiMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

export enum AiMessageStatus {
  STREAMING = 'STREAMING',
  DONE = 'DONE',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
  BLOCKED = 'BLOCKED',
}

export enum AiMessageFeedback {
  LIKE = 'LIKE',
  DISLIKE = 'DISLIKE',
}

export interface AiMessageUsage {
  model: string;
  /** 含 cachedInputTokens */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** 估算成本（元） */
  cost: number;
  /** 上游未返回用量时按字数估算 */
  estimated: boolean;
}

export class AiMessage {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  /** Markdown */
  content: string;
  reasoning: string | null;
  suggestions: string[] | null;
  status: AiMessageStatus;
  feedback: AiMessageFeedback | null;
  usage: AiMessageUsage | null;
  /** 扣减额度所属日期，退还时使用 */
  quotaDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const FINAL_MESSAGE_STATUSES: readonly AiMessageStatus[] = [
  AiMessageStatus.DONE,
  AiMessageStatus.STOPPED,
  AiMessageStatus.FAILED,
  AiMessageStatus.BLOCKED,
];
