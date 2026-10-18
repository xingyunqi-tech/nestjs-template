import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AiMessageInProgressError, AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiConversationsService, conversationNotFound } from './ai-conversations.service';
import { AiAccessService } from './ai-access.service';
import { AiContentSafetyService } from './ai-content-safety.service';
import { AiBudgetService } from './ai-budget.service';
import { AiQuotaService } from './ai-quota.service';
import { AiContextService } from './ai-context.service';
import { AiGenerationService } from './ai-generation.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { toTitle } from './ai-presenter';
import { AiMessageStatus } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';
import { SendAiMessageDto } from './dto/send-ai-message.dto';
import { TutorQuestionContextService } from '../practice/tutor-question-context.service';
import { BusinessException } from '../../common/exceptions/business.exception';

function messageInProgress(): ConflictException {
  return new ConflictException({ error: 'aiMessageInProgress' });
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly conversationsService: AiConversationsService,
    private readonly messageRepository: AiMessageRepository,
    private readonly accessService: AiAccessService,
    private readonly tutorQuestionContextService: TutorQuestionContextService,
    private readonly safetyService: AiContentSafetyService,
    private readonly budgetService: AiBudgetService,
    private readonly quotaService: AiQuotaService,
    private readonly contextService: AiContextService,
    private readonly streamService: AiMessageStreamService,
    private readonly generationService: AiGenerationService,
  ) {}

  /** 启动回答生成并返回回答消息 id；扣减额度后失败时退还额度 */
  async send(userId: number, conversationId: string, dto: SendAiMessageDto): Promise<{ messageId: string }> {
    const conversation = await this.conversationsService.findOwned(userId, conversationId);
    const { openId } = await this.accessService.assertCanUse(userId);
    const tutor = await this.tutorQuestionContextService.resolve(
      userId,
      conversation.contextId ?? '',
      dto.sessionId ?? null,
    );
    if (tutor.question.currentVersion !== conversation.contextVersion) {
      throw new BusinessException('aiConversationOutdated');
    }
    if ((await this.messageRepository.findStreamingIds(conversation.id)).length > 0) {
      throw messageInProgress();
    }
    await this.safetyService.assertInputSafe(openId, dto.content);
    await this.budgetService.assertWithinBudget();
    const quotaDate = await this.quotaService.consume(userId, 'chat');

    let messageId: string | null = null;
    try {
      const request = await this.contextService.buildChatRequest(conversation, tutor, dto.content);
      const exchange = await this.messageRepository.createExchange({
        conversationId: conversation.id,
        content: dto.content,
        quotaDate,
        title: toTitle(dto.content),
      });
      if (!exchange) {
        throw conversationNotFound();
      }
      messageId = exchange.assistant.id;
      await this.startStream(messageId);
      void this.generationService.start({
        messageId,
        conversationId: conversation.id,
        userId,
        openId,
        quotaDate,
        request,
      });
      return { messageId };
    } catch (error) {
      await this.rollback(userId, quotaDate, messageId);
      throw error instanceof AiMessageInProgressError ? messageInProgress() : error;
    }
  }

  /** 生成中时广播停止；已结束时不做处理 */
  async stop(userId: number, messageId: string): Promise<void> {
    const message = await this.conversationsService.findOwnedAssistantMessage(userId, messageId);
    if (message.status === AiMessageStatus.STREAMING) {
      await this.generationService.requestStop(message.id);
    }
  }

  private async startStream(messageId: string): Promise<void> {
    try {
      await this.streamService.append(messageId, AiStreamEventName.MESSAGE_START, { messageId });
    } catch (error) {
      this.logger.error(`Start stream of ${messageId} failed: ${this.messageOf(error)}`);
      throw new BusinessException('aiUnavailable');
    }
  }

  /** 未写入消息，或成功把回答置为 FAILED 时才退还，避免与其他收尾重复退还 */
  private async rollback(userId: number, quotaDate: string, messageId: string | null): Promise<void> {
    const closed = messageId
      ? await this.messageRepository
          .finish(messageId, {
            content: '',
            reasoning: null,
            suggestions: null,
            status: AiMessageStatus.FAILED,
            usage: null,
          })
          .catch((error: unknown) => {
            this.logger.error(`Mark ${messageId} failed: ${this.messageOf(error)}`);
            return false;
          })
      : true;
    if (!closed) {
      return;
    }
    await this.quotaService
      .refund(userId, 'chat', quotaDate)
      .catch((error: unknown) => this.logger.error(`Refund quota of user ${userId} failed: ${this.messageOf(error)}`));
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
