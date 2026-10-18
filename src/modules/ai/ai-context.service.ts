import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiConversationRepository } from './infrastructure/persistence/ai-conversation.repository';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiBudgetService } from './ai-budget.service';
import { AiConversation } from './domain/ai-conversation';
import { AiMessageRole } from './domain/ai-message';
import { buildReferenceMessage, buildTutorSystemPrompt, TutorQuestionPromptInput } from './domain/tutor-prompt';
import { buildSummaryRequest, splitHistory, SUMMARY_BATCH_THRESHOLD, toLlmMessages } from './domain/chat-history';
import { LlmChatMessage, LlmProvider, LlmUsageChunk } from '../../integrations/llm/llm-provider';
import { TutorQuestionContext } from '../practice/tutor-question-context.service';
import { AllConfigType } from '../../config/config.type';

/** 摘要之后读取的消息上限 */
const HISTORY_FETCH_LIMIT = 60;

const SUMMARY_MAX_TOKENS = 800;

export interface AiChatRequest {
  system: string;
  messages: LlmChatMessage[];
}

@Injectable()
export class AiContextService {
  private readonly logger = new Logger(AiContextService.name);

  constructor(
    private readonly conversationRepository: AiConversationRepository,
    private readonly messageRepository: AiMessageRepository,
    private readonly llmProvider: LlmProvider,
    private readonly budgetService: AiBudgetService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async buildChatRequest(
    conversation: AiConversation,
    tutor: TutorQuestionContext,
    content: string,
  ): Promise<AiChatRequest> {
    const history = await this.messageRepository.findAfter(
      conversation.id,
      conversation.summaryUpToMessageId,
      HISTORY_FETCH_LIMIT,
    );
    const { recent } = splitHistory(history);
    const { question, material, record } = tutor;
    const input: TutorQuestionPromptInput = {
      type: question.type,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      analysis: question.analysis,
      material: material ? [material.stem, material.material].filter(Boolean).join('\n') || null : null,
      userAnswer: record?.answer ?? null,
      isCorrect: record?.isCorrect ?? null,
    };
    const reference = buildReferenceMessage(input, conversation.summary);
    return {
      system: buildTutorSystemPrompt(input),
      messages: toLlmMessages([
        ...(reference ? [{ role: AiMessageRole.USER, content: reference }] : []),
        ...recent,
        { role: AiMessageRole.USER, content },
      ]),
    };
  }

  /** 摘要之外待压缩的消息达到阈值时合并进摘要 */
  async compact(conversationId: string): Promise<void> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      return;
    }
    const history = await this.messageRepository.findAfter(
      conversation.id,
      conversation.summaryUpToMessageId,
      HISTORY_FETCH_LIMIT,
    );
    const { older } = splitHistory(history);
    if (older.length < SUMMARY_BATCH_THRESHOLD) {
      return;
    }
    const request = buildSummaryRequest(conversation.summary, older);
    let summary = '';
    let usage: LlmUsageChunk | null = null;
    let failed = false;
    try {
      for await (const chunk of this.llmProvider.streamChat({ ...request, maxTokens: SUMMARY_MAX_TOKENS })) {
        if (chunk.type === 'answer') {
          summary += chunk.text;
        } else if (chunk.type === 'usage') {
          usage = chunk;
        }
      }
    } catch (error) {
      failed = true;
      this.logger.warn(`Summarize conversation ${conversationId} failed: ${this.messageOf(error)}`);
    }
    await this.budgetService
      .record({
        kind: 'chat',
        model: usage?.model ?? this.configService.get('llm.model', { infer: true }) ?? 'unknown',
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        failed,
        countsAsRequest: false,
      })
      .catch((error: unknown) => this.logger.warn(`Record summary usage failed: ${this.messageOf(error)}`));
    if (!failed && summary.trim() !== '') {
      await this.conversationRepository.updateSummary(
        conversation.id,
        conversation.summaryUpToMessageId,
        summary.trim(),
        older[older.length - 1].id,
      );
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
