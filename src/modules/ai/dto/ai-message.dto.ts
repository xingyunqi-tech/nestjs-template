import { ApiProperty } from '@nestjs/swagger';
import { AiMessageFeedback, AiMessageRole, AiMessageStatus } from '../domain/ai-message';

export class AiMessageDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  conversationId: string;

  @ApiProperty({ enum: AiMessageRole, enumName: 'AiMessageRole' })
  role: AiMessageRole;

  @ApiProperty({ type: String, description: 'Markdown；生成中为已下发的部分' })
  content: string;

  @ApiProperty({ type: String, nullable: true, description: '深度思考内容' })
  reasoning: string | null;

  @ApiProperty({ type: String, isArray: true, nullable: true, description: '推荐追问' })
  suggestions: string[] | null;

  @ApiProperty({ enum: AiMessageStatus, enumName: 'AiMessageStatus' })
  status: AiMessageStatus;

  @ApiProperty({ enum: AiMessageFeedback, enumName: 'AiMessageFeedback', nullable: true })
  feedback: AiMessageFeedback | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '生成中时为已下发内容对应的事件 id，可作为 GET /ai/messages/:id/events 的 after 续读',
  })
  lastEventId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class AiMessagePageDto {
  @ApiProperty({ type: AiMessageDto, isArray: true, description: '按时间升序' })
  list: AiMessageDto[];

  @ApiProperty({ type: Boolean, description: '是否还有更早的消息' })
  hasMore: boolean;
}
