import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FeedbackType {
  BUG = 'bug',
  SUGGESTION = 'suggestion',
  COMPLAINT = 'complaint',
  OTHER = 'other',
  QUESTION_ERROR = 'question_error',
  AI_CONTENT = 'ai_content',
}

/** 通用反馈接口可提交的类型 */
export const GENERAL_FEEDBACK_TYPES = [
  FeedbackType.BUG,
  FeedbackType.SUGGESTION,
  FeedbackType.COMPLAINT,
  FeedbackType.OTHER,
];

/** 用户可通过反馈接口查询的类型 */
export const USER_QUERYABLE_FEEDBACK_TYPES = [...GENERAL_FEEDBACK_TYPES, FeedbackType.QUESTION_ERROR];

/** 后台纠错与举报列表处理的类型 */
export const QUESTION_REPORT_TYPES = [FeedbackType.QUESTION_ERROR, FeedbackType.AI_CONTENT];

export enum FeedbackStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum QuestionReportReason {
  ANSWER_WRONG = 'answer_wrong',
  ANALYSIS_WRONG = 'analysis_wrong',
  STEM_TYPO = 'stem_typo',
  OTHER = 'other',
}

export class AiMessageSnapshot {
  @ApiProperty({ type: String, description: 'Markdown' })
  content: string;

  @ApiProperty({ type: String, nullable: true, description: '深度思考内容' })
  reasoning: string | null;

  @ApiProperty({ type: String, description: '举报时的消息状态' })
  status: string;

  @ApiProperty({ type: String, format: 'date-time', description: '消息生成时间' })
  createdAt: string;
}

export class Feedback {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty({ type: Number, nullable: true, description: '提交人注销后为空' })
  userId: number | null;

  @ApiProperty({ enum: FeedbackType })
  type: FeedbackType;

  @ApiProperty({ type: String })
  content: string;

  @ApiPropertyOptional({ type: [String], nullable: true })
  images?: string[] | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contact?: string | null;

  @ApiProperty({ enum: FeedbackStatus })
  status: FeedbackStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  reply?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  questionId?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: '提交时题目的当前版本' })
  questionVersion?: number | null;

  @ApiPropertyOptional({ enum: QuestionReportReason, enumName: 'QuestionReportReason', nullable: true })
  reason?: QuestionReportReason | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: '关联的勘误任务' })
  errataId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: '被举报的 AI 消息' })
  messageId?: string | null;

  @ApiPropertyOptional({
    type: () => AiMessageSnapshot,
    nullable: true,
    description: '举报时的 AI 消息内容，消息删除后仍保留',
  })
  messageSnapshot?: AiMessageSnapshot | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
