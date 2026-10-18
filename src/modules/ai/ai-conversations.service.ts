import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiConversationRepository } from './infrastructure/persistence/ai-conversation.repository';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiAccessService } from './ai-access.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiGenerationService } from './ai-generation.service';
import { toConversationDto, toMessageDto, toTitle } from './ai-presenter';
import { AiContextType, AiConversation } from './domain/ai-conversation';
import { AiMessage, AiMessageRole, AiMessageStatus } from './domain/ai-message';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';
import { QueryAiConversationsDto } from './dto/query-ai-conversations.dto';
import { QueryAiMessagesDto } from './dto/query-ai-messages.dto';
import { AiConversationDto } from './dto/ai-conversation.dto';
import { AiMessageDto, AiMessagePageDto } from './dto/ai-message.dto';
import { TutorQuestionContextService } from '../practice/tutor-question-context.service';
import { AnswerVisibilityService } from '../practice/answer-visibility.service';
import { HiddenReason } from '../practice/domain/hidden-reason';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IPaginationOptions } from '../../common/types/pagination-options';

export function conversationNotFound(): NotFoundException {
  return new NotFoundException({ error: 'aiConversationNotFound' });
}

export function messageNotFound(): NotFoundException {
  return new NotFoundException({ error: 'aiMessageNotFound' });
}

@Injectable()
export class AiConversationsService {
  private readonly logger = new Logger(AiConversationsService.name);

  constructor(
    private readonly conversationRepository: AiConversationRepository,
    private readonly messageRepository: AiMessageRepository,
    private readonly accessService: AiAccessService,
    private readonly tutorQuestionContextService: TutorQuestionContextService,
    private readonly streamService: AiMessageStreamService,
    private readonly generationService: AiGenerationService,
    private readonly answerVisibilityService: AnswerVisibilityService,
  ) {}

  /** 校验前置条件与答案可见性；同一用户同一题同一版本复用会话 */
  async create(userId: number, dto: CreateAiConversationDto): Promise<AiConversationDto> {
    await this.accessService.assertCanUse(userId);
    const { question } = await this.tutorQuestionContextService.resolve(userId, dto.contextId, dto.sessionId ?? null);
    const conversation = await this.conversationRepository.findOrCreate({
      userId,
      title: toTitle(question.stem),
      contextType: AiContextType.QUESTION,
      contextId: question.id,
      contextVersion: question.currentVersion,
    });
    return toConversationDto(conversation);
  }

  async findMany(
    userId: number,
    query: QueryAiConversationsDto,
  ): Promise<{ data: AiConversationDto[]; total: number; paginationOptions: IPaginationOptions }> {
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.conversationRepository.findManyByUser(userId, paginationOptions);
    return { data: data.map(toConversationDto), total, paginationOptions };
  }

  async findMessages(userId: number, conversationId: string, query: QueryAiMessagesDto): Promise<AiMessagePageDto> {
    await this.assertReadable(userId, await this.findOwned(userId, conversationId));
    const { data, hasMore } = await this.messageRepository.findPage(conversationId, {
      beforeId: query.beforeId?.toLowerCase(),
      limit: query.limit ?? 20,
    });
    return { list: await Promise.all(data.map((message) => this.present(message))), hasMore };
  }

  async getMessage(userId: number, messageId: string): Promise<AiMessageDto> {
    return this.present(await this.findReadableAssistantMessage(userId, messageId));
  }

  /** @throws BusinessException answerHidden 会话的题目在进行中的模考里 */
  async findReadableAssistantMessage(userId: number, messageId: string): Promise<AiMessage> {
    return (await this.findReadableAssistant(userId, messageId)).message;
  }

  /** @throws BusinessException answerHidden 会话的题目在进行中的模考里 */
  async findReadableAssistant(
    userId: number,
    messageId: string,
  ): Promise<{ message: AiMessage; conversation: AiConversation }> {
    const message = await this.findOwnedAssistantMessage(userId, messageId);
    const conversation = await this.conversationRepository.findById(message.conversationId);
    if (!conversation) {
      throw messageNotFound();
    }
    await this.assertReadable(userId, conversation);
    return { message, conversation };
  }

  /** 生成中的回答先广播停止，消息随会话删除 */
  async remove(userId: number, conversationId: string): Promise<void> {
    await this.findOwned(userId, conversationId);
    const streamingIds = await this.messageRepository.findStreamingIds(conversationId);
    await Promise.all(
      streamingIds.map((id) =>
        this.generationService
          .requestStop(id)
          .catch((error: unknown) =>
            this.logger.warn(`Stop ${id} failed: ${error instanceof Error ? error.message : String(error)}`),
          ),
      ),
    );
    await this.conversationRepository.remove(conversationId);
  }

  async findOwned(userId: number, conversationId: string): Promise<AiConversation> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (conversation?.userId !== userId) {
      throw conversationNotFound();
    }
    return conversation;
  }

  async findOwnedAssistantMessage(userId: number, messageId: string): Promise<AiMessage> {
    const message = await this.messageRepository.findOwned(userId, messageId);
    if (message?.role !== AiMessageRole.ASSISTANT) {
      throw messageNotFound();
    }
    return message;
  }

  private async assertReadable(userId: number, conversation: AiConversation): Promise<void> {
    if (!conversation.contextId) {
      return;
    }
    const inMock = await this.answerVisibilityService.findInProgressMockQuestionIds(userId);
    if (inMock.has(conversation.contextId)) {
      throw new BusinessException('answerHidden', { hiddenReason: HiddenReason.MOCK_IN_PROGRESS });
    }
  }

  /** 生成中的消息取事件流中已下发的内容 */
  async present(message: AiMessage): Promise<AiMessageDto> {
    if (message.status !== AiMessageStatus.STREAMING) {
      return toMessageDto(message);
    }
    return toMessageDto(message, await this.streamService.snapshot(message.id).catch(() => null));
  }
}
