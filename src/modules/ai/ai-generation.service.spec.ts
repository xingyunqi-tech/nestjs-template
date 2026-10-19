import type { Mocked } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AiGenerationJob, AiGenerationService, BLOCKED_NOTICE } from './ai-generation.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiContentSafetyService, OutputVerdict } from './ai-content-safety.service';
import { AiQuotaService } from './ai-quota.service';
import { AiBudgetService } from './ai-budget.service';
import { AiContextService } from './ai-context.service';
import { MemoryAiRealtimeStore } from './infrastructure/realtime/memory-ai-realtime.store';
import { aiMessageStreamKey } from './infrastructure/realtime/ai-realtime.store';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiMessageStatus } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';
import { SUGGESTIONS_MARKER } from './domain/tutor-prompt';
import { LlmError, LlmProvider, LlmStreamChatParams, LlmStreamChunk } from '../../integrations/llm/llm-provider';

const PARAGRAPH_1 = `${'一'.repeat(60)}\n\n`;
const PARAGRAPH_2 = `${'二'.repeat(120)}\n\n`;
const USAGE: LlmStreamChunk = {
  type: 'usage',
  model: 'deepseek-chat',
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 20,
};

describe('AiGenerationService', () => {
  let store: MemoryAiRealtimeStore;
  let streamChat: Mocked<LlmProvider>['streamChat'];
  let verdicts: OutputVerdict[];
  let safety: { checkOutput: ReturnType<typeof vi.fn> };
  let messageRepository: Mocked<Pick<AiMessageRepository, 'finish' | 'findById'>>;
  let quota: { refund: ReturnType<typeof vi.fn> };
  let budget: { record: ReturnType<typeof vi.fn> };
  let context: { compact: ReturnType<typeof vi.fn> };
  let service: AiGenerationService;

  const job: AiGenerationJob = {
    messageId: 'm1',
    conversationId: 'c1',
    userId: 7,
    quotaDate: '2026-10-17',
    request: { system: 'system', messages: [{ role: 'user', content: '为什么' }] },
  };

  const respondWith = (chunks: LlmStreamChunk[]): void => {
    streamChat.mockImplementation(async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    });
  };

  const events = async (): Promise<{ event: string; data: Record<string, unknown> }[]> =>
    ((await store.read(aiMessageStreamKey(job.messageId), '0', 100)) ?? []).map(({ event, data }) => ({ event, data }));

  beforeEach(() => {
    store = new MemoryAiRealtimeStore();
    streamChat = vi.fn();
    verdicts = [];
    safety = { checkOutput: vi.fn(() => Promise.resolve(verdicts.shift() ?? 'pass')) };
    messageRepository = { finish: vi.fn().mockResolvedValue(true), findById: vi.fn() };
    quota = { refund: vi.fn().mockResolvedValue(undefined) };
    budget = { record: vi.fn().mockResolvedValue(0.0012) };
    context = { compact: vi.fn().mockResolvedValue(undefined) };
    service = new AiGenerationService(
      { streamChat },
      safety as unknown as AiContentSafetyService,
      new AiMessageStreamService(store, messageRepository as unknown as AiMessageRepository),
      messageRepository as unknown as AiMessageRepository,
      quota as unknown as AiQuotaService,
      budget as unknown as AiBudgetService,
      context as unknown as AiContextService,
      store,
      { get: () => 'deepseek-chat' } as unknown as ConfigService,
    );
    service.onModuleInit();
  });

  it('should deliver reasoning before the answer, checked segments and suggestions, and save the answer as DONE', async () => {
    respondWith([
      { type: 'reasoning', text: '思考' },
      { type: 'answer', text: PARAGRAPH_1 },
      { type: 'answer', text: `结论。\n${SUGGESTIONS_MARKER}为什么？|还有吗？` },
      USAGE,
      { type: 'finish', finishReason: 'stop' },
    ]);

    await service.start(job);

    expect(messageRepository.finish).toHaveBeenCalledWith('m1', {
      content: `${PARAGRAPH_1}结论。\n`,
      reasoning: '思考',
      suggestions: ['为什么？', '还有吗？'],
      status: AiMessageStatus.DONE,
      usage: {
        model: 'deepseek-chat',
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 20,
        cost: 0.0012,
        estimated: false,
      },
    });
    expect(await events()).toEqual([
      { event: AiStreamEventName.REASONING_DELTA, data: { text: '思考' } },
      { event: AiStreamEventName.ANSWER_DELTA, data: { text: PARAGRAPH_1 } },
      { event: AiStreamEventName.ANSWER_DELTA, data: { text: '结论。\n' } },
      { event: AiStreamEventName.SUGGESTIONS, data: { items: ['为什么？', '还有吗？'] } },
      {
        event: AiStreamEventName.MESSAGE_DONE,
        data: { status: AiMessageStatus.DONE, usage: { inputTokens: 100, outputTokens: 50 } },
      },
    ]);
    expect(safety.checkOutput.mock.calls.map(([check]) => check)).toEqual([
      { userId: 7, sessionId: 'm1:reasoning', content: '思考' },
      { userId: 7, sessionId: 'm1', content: PARAGRAPH_1 },
      { userId: 7, sessionId: 'm1', content: '结论。\n' },
      { userId: 7, sessionId: 'm1', content: '为什么？\n还有吗？' },
    ]);
    expect(budget.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chat', failed: false, countsAsRequest: true }),
    );
    expect(quota.refund).not.toHaveBeenCalled();
    expect(context.compact).toHaveBeenCalledWith('c1');
  });

  it('should stop upstream, append the notice and keep the quota when a segment is blocked', async () => {
    let signal: AbortSignal | undefined;
    streamChat.mockImplementation(async function* (params: LlmStreamChatParams) {
      signal = params.signal;
      yield { type: 'answer', text: PARAGRAPH_1 };
      yield { type: 'answer', text: PARAGRAPH_2 };
      yield { type: 'answer', text: '不应送检的内容\n\n' };
    });
    verdicts = ['pass', 'blocked'];

    await service.start(job);

    expect(signal?.aborted).toBe(true);
    expect(safety.checkOutput).toHaveBeenCalledTimes(2);
    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        content: PARAGRAPH_1 + BLOCKED_NOTICE,
        status: AiMessageStatus.BLOCKED,
        suggestions: null,
        usage: expect.objectContaining({ estimated: true }),
      }),
    );
    expect(await events()).toEqual([
      { event: AiStreamEventName.ANSWER_DELTA, data: { text: PARAGRAPH_1 } },
      { event: AiStreamEventName.ANSWER_DELTA, data: { text: BLOCKED_NOTICE } },
      { event: AiStreamEventName.MESSAGE_DONE, data: expect.objectContaining({ status: AiMessageStatus.BLOCKED }) },
    ]);
    expect(quota.refund).not.toHaveBeenCalled();
    expect(context.compact).not.toHaveBeenCalled();
  });

  it('should mark the answer BLOCKED when upstream finishes with a content filter', async () => {
    respondWith([
      { type: 'answer', text: '部分' },
      { type: 'finish', finishReason: 'contentFilter' },
    ]);

    await service.start(job);

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ content: `部分${BLOCKED_NOTICE}`, status: AiMessageStatus.BLOCKED }),
    );
  });

  it('should fail and refund the quota of the original date when the security check errors', async () => {
    respondWith([{ type: 'answer', text: PARAGRAPH_1 }]);
    verdicts = ['error'];

    await service.start(job);

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ content: '', status: AiMessageStatus.FAILED }),
    );
    expect(quota.refund).toHaveBeenCalledWith(7, 'chat', '2026-10-17');
    expect(await events()).toEqual([{ event: AiStreamEventName.ERROR, data: { code: 'aiGenerationFailed' } }]);
  });

  it('should fail, record a failure and refund the quota when upstream errors', async () => {
    streamChat.mockImplementation(async function* () {
      yield* [];
      throw new LlmError('httpError', 'boom', { status: 500 });
    });

    await service.start(job);

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        status: AiMessageStatus.FAILED,
        usage: expect.objectContaining({ inputTokens: 0, outputTokens: 0, estimated: false }),
      }),
    );
    expect(budget.record).toHaveBeenCalledWith(expect.objectContaining({ failed: true }));
    expect(quota.refund).toHaveBeenCalledWith(7, 'chat', '2026-10-17');
  });

  it('should not refund twice when the message was already closed elsewhere', async () => {
    streamChat.mockImplementation(async function* () {
      yield* [];
      throw new LlmError('timeout', 'slow');
    });
    messageRepository.finish.mockResolvedValue(false);

    await service.start(job);

    expect(quota.refund).not.toHaveBeenCalled();
    expect(await events()).toEqual([{ event: AiStreamEventName.ERROR, data: { code: 'aiGenerationInterrupted' } }]);
  });

  it('should report an interrupted answer without refunding when saving fails', async () => {
    respondWith([
      { type: 'answer', text: '回答' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    messageRepository.finish.mockRejectedValue(new Error('db down'));

    await service.start(job);

    expect(quota.refund).not.toHaveBeenCalled();
    expect((await events()).at(-1)).toEqual({
      event: AiStreamEventName.ERROR,
      data: { code: 'aiGenerationInterrupted' },
    });
  });

  it('should record STOPPED when upstream ends normally after a stop broadcast', async () => {
    streamChat.mockImplementation(async function* (params: LlmStreamChatParams) {
      yield { type: 'answer', text: PARAGRAPH_1 };
      await new Promise((resolve) => params.signal?.addEventListener('abort', resolve));
      yield { type: 'finish', finishReason: 'stop' };
    });

    const running = service.start(job);
    await vi.waitFor(async () => expect(await events()).toHaveLength(1));
    await service.requestStop(job.messageId);
    await running;

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ content: PARAGRAPH_1, status: AiMessageStatus.STOPPED, suggestions: null }),
    );
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('should fail running answers and refund their quota on application shutdown', async () => {
    streamChat.mockImplementation(async function* (params: LlmStreamChatParams) {
      yield { type: 'answer', text: PARAGRAPH_1 };
      await new Promise((resolve) => params.signal?.addEventListener('abort', resolve));
      throw new LlmError('aborted', 'aborted');
    });

    void service.start(job);
    await vi.waitFor(async () => expect(await events()).toHaveLength(1));
    await service.onApplicationShutdown();

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ content: PARAGRAPH_1, status: AiMessageStatus.FAILED }),
    );
    expect(quota.refund).toHaveBeenCalledWith(7, 'chat', '2026-10-17');
  });

  it('should save delivered content as STOPPED without refunding when a stop is broadcast', async () => {
    streamChat.mockImplementation(async function* (params: LlmStreamChatParams) {
      yield { type: 'answer', text: PARAGRAPH_1 };
      await new Promise((resolve) => params.signal?.addEventListener('abort', resolve));
      throw new LlmError('aborted', 'aborted');
    });

    const running = service.start(job);
    await vi.waitFor(async () => expect(await events()).toHaveLength(1));
    await service.requestStop(job.messageId);
    await running;

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ content: PARAGRAPH_1, status: AiMessageStatus.STOPPED }),
    );
    expect(quota.refund).not.toHaveBeenCalled();
    expect((await events()).at(-1)).toEqual({
      event: AiStreamEventName.MESSAGE_DONE,
      data: expect.objectContaining({ status: AiMessageStatus.STOPPED }),
    });
    expect(context.compact).toHaveBeenCalledWith('c1');
  });

  it('should ignore a stop broadcast for a message it does not hold', async () => {
    respondWith([
      { type: 'answer', text: '完整回答' },
      { type: 'finish', finishReason: 'stop' },
    ]);

    await service.requestStop('other');
    await service.start(job);

    expect(messageRepository.finish).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: AiMessageStatus.DONE }),
    );
  });
});
