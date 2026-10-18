import { Injectable } from '@nestjs/common';
import { AiConversationsService } from './ai-conversations.service';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiMessageFeedback } from './domain/ai-message';
import { ReportAiMessageDto } from './dto/ai-message-feedback.dto';
import { FeedbacksService } from '../feedbacks/feedbacks.service';
import { Feedback } from '../feedbacks/domain/feedback';

/** 用户对 AI 回答的点赞点踩与投诉举报 */
@Injectable()
export class AiMessageFeedbackService {
  constructor(
    private readonly conversationsService: AiConversationsService,
    private readonly messageRepository: AiMessageRepository,
    private readonly feedbacksService: FeedbacksService,
  ) {}

  /** feedback 为 null 时撤销 */
  async rate(userId: number, messageId: string, feedback: AiMessageFeedback | null): Promise<void> {
    const message = await this.conversationsService.findOwnedAssistantMessage(userId, messageId);
    await this.messageRepository.setFeedback(message.id, feedback);
  }

  /**
   * 创建 ai_content 举报，记录举报时的消息内容
   * @throws BusinessException answerHidden 会话的题目在进行中的模考里
   */
  async report(userId: number, messageId: string, dto: ReportAiMessageDto): Promise<Feedback> {
    const { message, conversation } = await this.conversationsService.findReadableAssistant(userId, messageId);
    const presented = await this.conversationsService.present(message);
    return this.feedbacksService.createAiContentReport(userId, {
      messageId: message.id,
      questionId: conversation.contextId,
      questionVersion: conversation.contextVersion,
      content: dto.content ?? '',
      messageSnapshot: {
        content: presented.content,
        reasoning: presented.reasoning,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
      },
    });
  }
}
