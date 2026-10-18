import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_STOP_CHANNEL, AiRealtimeStore } from './infrastructure/realtime/ai-realtime.store';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiMessageStreamService, publicUsage } from './ai-message-stream.service';
import { AiContentSafetyService } from './ai-content-safety.service';
import { AiQuotaService } from './ai-quota.service';
import { AiBudgetService } from './ai-budget.service';
import { AiChatRequest, AiContextService } from './ai-context.service';
import { AiMessageStatus, AiMessageUsage } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';
import { OutputSegmenter, OutputSegmenterOptions } from './domain/output-segmenter';
import { parseSuggestions, SUGGESTIONS_MARKER } from './domain/tutor-prompt';
import { approximateTokens } from './domain/ai-cost';
import { LlmFinishReason, LlmProvider, LlmUsageChunk } from '../../integrations/llm/llm-provider';
import { AllConfigType } from '../../config/config.type';

export const BLOCKED_NOTICE = '\n\n> 后续内容未通过安全检测，已停止生成。';

const MAX_OUTPUT_TOKENS = 2048;

const STOP_REASON = 'stopped';

const SHUTDOWN_REASON = 'shutdown';

export const SEGMENT_OPTIONS: OutputSegmenterOptions = { firstMinLength: 50, minLength: 100, maxLength: 200 };

type Outcome = AiMessageStatus.DONE | AiMessageStatus.STOPPED | AiMessageStatus.BLOCKED | AiMessageStatus.FAILED;

type TextType = 'answer' | 'reasoning';

interface Segment {
  type: TextType;
  text: string;
}

export interface AiGenerationJob {
  messageId: string;
  conversationId: string;
  userId: number;
  openId: string;
  /** 扣减额度所属日期 */
  quotaDate: string;
  request: AiChatRequest;
}

interface GenerationState {
  content: string;
  reasoning: string;
  /** 上游产出的全部文本，含未下发部分 */
  generated: string;
  suggestions: string[];
  usage: LlmUsageChunk | null;
  finishReason: LlmFinishReason | null;
}

/** 回答生成任务：进程内异步执行，输出按段送检后写入消息事件流 */
@Injectable()
export class AiGenerationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AiGenerationService.name);
  private readonly running = new Map<string, { controller: AbortController; done: Promise<void> }>();

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly safetyService: AiContentSafetyService,
    private readonly streamService: AiMessageStreamService,
    private readonly messageRepository: AiMessageRepository,
    private readonly quotaService: AiQuotaService,
    private readonly budgetService: AiBudgetService,
    private readonly contextService: AiContextService,
    private readonly store: AiRealtimeStore,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  onModuleInit(): void {
    this.store
      .subscribe(AI_STOP_CHANNEL, (messageId) => this.running.get(messageId)?.controller.abort(STOP_REASON))
      .catch((error: unknown) => this.logger.error(`Subscribe ${AI_STOP_CHANNEL} failed: ${this.messageOf(error)}`));
  }

  /** 启动生成，返回的 Promise 在任务结束时完成且不会 reject */
  start(job: AiGenerationJob): Promise<void> {
    const controller = new AbortController();
    const done = this.run(job, controller)
      .catch((error: unknown) => this.logger.error(`Generation ${job.messageId} crashed: ${this.messageOf(error)}`))
      .finally(() => this.running.delete(job.messageId));
    this.running.set(job.messageId, { controller, done });
    return done;
  }

  /** 取消本实例上的生成任务，按 FAILED 收尾 */
  async onApplicationShutdown(): Promise<void> {
    const tasks = [...this.running.values()];
    tasks.forEach(({ controller }) => controller.abort(SHUTDOWN_REASON));
    await Promise.all(tasks.map(({ done }) => done));
  }

  /** 广播停止，持有该消息生成任务的实例取消上游请求 */
  requestStop(messageId: string): Promise<void> {
    return this.store.publish(AI_STOP_CHANNEL, messageId);
  }

  private async run(job: AiGenerationJob, controller: AbortController): Promise<void> {
    const state: GenerationState = {
      content: '',
      reasoning: '',
      generated: '',
      suggestions: [],
      usage: null,
      finishReason: null,
    };
    const outcome = await this.generate(job, controller, state);
    await this.complete(job, outcome, state);
  }

  private async generate(job: AiGenerationJob, controller: AbortController, state: GenerationState): Promise<Outcome> {
    const buffers: Record<TextType, OutputSegmenter> = {
      answer: new OutputSegmenter({ ...SEGMENT_OPTIONS, marker: SUGGESTIONS_MARKER }),
      reasoning: new OutputSegmenter(SEGMENT_OPTIONS),
    };
    try {
      for await (const chunk of this.llmProvider.streamChat({
        ...job.request,
        maxTokens: MAX_OUTPUT_TOKENS,
        signal: controller.signal,
      })) {
        if (chunk.type === 'usage') {
          state.usage = chunk;
        } else if (chunk.type === 'finish') {
          state.finishReason = chunk.finishReason;
        } else {
          state.generated += chunk.text;
          const segments: Segment[] =
            chunk.type === 'answer' ? buffers.reasoning.flush().map((text) => ({ type: 'reasoning', text })) : [];
          segments.push(...buffers[chunk.type].push(chunk.text).map((text) => ({ type: chunk.type, text })));
          const outcome = await this.deliver(job, segments, state, controller);
          if (outcome) {
            if (!controller.signal.aborted) {
              controller.abort(outcome);
            }
            return outcome;
          }
        }
      }
      const aborted = this.abortedOutcome(controller);
      if (aborted) {
        return aborted;
      }
      const remaining = (['reasoning', 'answer'] as const).flatMap((type) =>
        buffers[type].flush().map((text): Segment => ({ type, text })),
      );
      const outcome = await this.deliver(job, remaining, state, controller);
      if (outcome) {
        return outcome;
      }
      if (state.finishReason === 'contentFilter') {
        return AiMessageStatus.BLOCKED;
      }
      state.suggestions = await this.checkSuggestions(job, parseSuggestions(buffers.answer.trailer));
      return AiMessageStatus.DONE;
    } catch (error) {
      if (controller.signal.reason === STOP_REASON) {
        return AiMessageStatus.STOPPED;
      }
      this.logger.warn(`Generation ${job.messageId} failed: ${this.messageOf(error)}`);
      return AiMessageStatus.FAILED;
    }
  }

  /** 逐段送检并下发；需要结束时返回结果 */
  private async deliver(
    job: AiGenerationJob,
    segments: Segment[],
    state: GenerationState,
    controller: AbortController,
  ): Promise<Outcome | null> {
    for (const { type, text: segment } of segments) {
      const abortedBefore = this.abortedOutcome(controller);
      if (abortedBefore) {
        return abortedBefore;
      }
      const verdict = await this.safetyService.checkOutput(job.openId, segment);
      const abortedAfter = this.abortedOutcome(controller);
      if (abortedAfter) {
        return abortedAfter;
      }
      if (verdict === 'blocked') {
        return AiMessageStatus.BLOCKED;
      }
      if (verdict === 'error') {
        return AiMessageStatus.FAILED;
      }
      if (type === 'answer') {
        state.content += segment;
      } else {
        state.reasoning += segment;
      }
      await this.streamService.append(
        job.messageId,
        type === 'answer' ? AiStreamEventName.ANSWER_DELTA : AiStreamEventName.REASONING_DELTA,
        { text: segment },
      );
    }
    return null;
  }

  private abortedOutcome(controller: AbortController): Outcome | null {
    if (!controller.signal.aborted) {
      return null;
    }
    return controller.signal.reason === STOP_REASON ? AiMessageStatus.STOPPED : AiMessageStatus.FAILED;
  }

  /** 推荐追问未通过送检时不下发 */
  private async checkSuggestions(job: AiGenerationJob, suggestions: string[]): Promise<string[]> {
    if (suggestions.length === 0) {
      return [];
    }
    return (await this.safetyService.checkOutput(job.openId, suggestions.join('\n'))) === 'pass' ? suggestions : [];
  }

  private async complete(job: AiGenerationJob, outcome: Outcome, state: GenerationState): Promise<void> {
    if (outcome === AiMessageStatus.BLOCKED) {
      state.content += BLOCKED_NOTICE;
      await this.appendQuietly(job.messageId, AiStreamEventName.ANSWER_DELTA, { text: BLOCKED_NOTICE });
    }
    if (outcome === AiMessageStatus.DONE && state.suggestions.length > 0) {
      await this.appendQuietly(job.messageId, AiStreamEventName.SUGGESTIONS, { items: state.suggestions });
    }
    const usage = await this.recordUsage(job, outcome, state);

    let finished = false;
    try {
      finished = await this.messageRepository.finish(job.messageId, {
        content: state.content,
        reasoning: state.reasoning || null,
        suggestions: outcome === AiMessageStatus.DONE ? state.suggestions : null,
        status: outcome,
        usage,
      });
    } catch (error) {
      this.logger.error(`Save message ${job.messageId} failed: ${this.messageOf(error)}`);
    }
    if (finished && outcome === AiMessageStatus.FAILED) {
      await this.quotaService
        .refund(job.userId, 'chat', job.quotaDate)
        .catch((error: unknown) =>
          this.logger.error(`Refund quota of ${job.messageId} failed: ${this.messageOf(error)}`),
        );
    }

    if (!finished) {
      await this.appendQuietly(job.messageId, AiStreamEventName.ERROR, { code: 'aiGenerationInterrupted' });
    } else if (outcome === AiMessageStatus.FAILED) {
      await this.appendQuietly(job.messageId, AiStreamEventName.ERROR, { code: 'aiGenerationFailed' });
    } else {
      await this.appendQuietly(job.messageId, AiStreamEventName.MESSAGE_DONE, {
        status: outcome,
        usage: publicUsage(usage),
      });
    }

    if (finished && (outcome === AiMessageStatus.DONE || outcome === AiMessageStatus.STOPPED)) {
      await this.contextService
        .compact(job.conversationId)
        .catch((error: unknown) => this.logger.warn(`Compact ${job.conversationId} failed: ${this.messageOf(error)}`));
    }
  }

  private async recordUsage(job: AiGenerationJob, outcome: Outcome, state: GenerationState): Promise<AiMessageUsage> {
    const estimated = !state.usage && state.generated.length > 0;
    const prompt = [job.request.system, ...job.request.messages.map((message) => message.content)].join('\n');
    const usage: AiMessageUsage = {
      model: state.usage?.model ?? this.configService.get('llm.model', { infer: true }) ?? 'unknown',
      inputTokens: state.usage?.inputTokens ?? (estimated ? approximateTokens(prompt) : 0),
      outputTokens: state.usage?.outputTokens ?? (estimated ? approximateTokens(state.generated) : 0),
      cachedInputTokens: state.usage?.cachedInputTokens ?? 0,
      cost: 0,
      estimated,
    };
    try {
      usage.cost = await this.budgetService.record({
        kind: 'chat',
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        failed: outcome === AiMessageStatus.FAILED,
        countsAsRequest: true,
      });
    } catch (error) {
      this.logger.error(`Record usage of ${job.messageId} failed: ${this.messageOf(error)}`);
    }
    return usage;
  }

  private async appendQuietly(
    messageId: string,
    event: AiStreamEventName,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.streamService
      .append(messageId, event, data)
      .catch((error: unknown) => this.logger.error(`Append ${event} to ${messageId} failed: ${this.messageOf(error)}`));
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
