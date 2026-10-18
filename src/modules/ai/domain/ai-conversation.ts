export enum AiContextType {
  QUESTION = 'QUESTION',
  GENERAL = 'GENERAL',
  WRONG_ANALYSIS = 'WRONG_ANALYSIS',
  REPORT = 'REPORT',
}

export class AiConversation {
  id: string;
  userId: number;
  /** 首轮问题截断 */
  title: string;
  contextType: AiContextType;
  /** QUESTION 为题目 id */
  contextId: string | null;
  /** QUESTION 为题目版本 */
  contextVersion: number | null;
  /** 早期消息摘要 */
  summary: string | null;
  /** 摘要覆盖到的最后一条消息 */
  summaryUpToMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
