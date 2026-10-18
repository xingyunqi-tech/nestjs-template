import type { Mocked } from 'vitest';
import { AI_STREAM_TIMINGS, AiMessageStreamService, AiStreamFollowItem } from './ai-message-stream.service';
import { MemoryAiRealtimeStore } from './infrastructure/realtime/memory-ai-realtime.store';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiMessage, AiMessageRole, AiMessageStatus } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';

const message = (overrides: Partial<AiMessage> = {}): AiMessage =>
  Object.assign(new AiMessage(), {
    id: 'm1',
    conversationId: 'c1',
    role: AiMessageRole.ASSISTANT,
    content: '完整回答',
    reasoning: null,
    suggestions: ['追问'],
    status: AiMessageStatus.DONE,
    feedback: null,
    usage: { model: 'x', inputTokens: 3, outputTokens: 4, cachedInputTokens: 0, cost: 0.1, estimated: false },
    quotaDate: '2026-10-18',
    ...overrides,
  });

async function collect(items: AsyncIterable<AiStreamFollowItem>, limit = 50): Promise<AiStreamFollowItem[]> {
  const result: AiStreamFollowItem[] = [];
  for await (const item of items) {
    result.push(item);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

describe('AiMessageStreamService', () => {
  const timings = { ...AI_STREAM_TIMINGS };
  let store: MemoryAiRealtimeStore;
  let repository: Mocked<Pick<AiMessageRepository, 'findById'>>;
  let service: AiMessageStreamService;

  beforeEach(() => {
    Object.assign(AI_STREAM_TIMINGS, { pollIntervalMs: 5, heartbeatIntervalMs: 1000, followTimeoutMs: 1000 });
    store = new MemoryAiRealtimeStore();
    repository = { findById: vi.fn().mockResolvedValue(message({ status: AiMessageStatus.STREAMING })) };
    service = new AiMessageStreamService(store, repository as unknown as AiMessageRepository);
  });

  afterEach(() => Object.assign(AI_STREAM_TIMINGS, timings));

  it('should resume after the last received event once the client reconnects', async () => {
    await service.append('m1', AiStreamEventName.MESSAGE_START, { messageId: 'm1' });
    const firstId = await service.append('m1', AiStreamEventName.ANSWER_DELTA, { text: '第一段' });

    const disconnected = new AbortController();
    const firstConnection: AiStreamFollowItem[] = [];
    for await (const item of service.follow('m1', '0', disconnected.signal)) {
      firstConnection.push(item);
      if (item.type === 'entry' && item.entry.id === firstId) {
        disconnected.abort();
      }
    }
    await service.append('m1', AiStreamEventName.ANSWER_DELTA, { text: '第二段' });
    await service.append('m1', AiStreamEventName.MESSAGE_DONE, { status: AiMessageStatus.DONE, usage: null });

    const resumed = await collect(service.follow('m1', firstId, new AbortController().signal));

    expect(firstConnection.map((item) => item.type === 'entry' && item.entry.event)).toEqual([
      AiStreamEventName.MESSAGE_START,
      AiStreamEventName.ANSWER_DELTA,
    ]);
    expect(resumed.map((item) => item.type === 'entry' && item.entry.data)).toEqual([
      { text: '第二段' },
      { status: AiMessageStatus.DONE, usage: null },
    ]);
  });

  it('should wait for new events while the answer is still generating', async () => {
    await service.append('m1', AiStreamEventName.MESSAGE_START, { messageId: 'm1' });
    const following = collect(service.follow('m1', '0', new AbortController().signal));

    setTimeout(() => {
      void service.append('m1', AiStreamEventName.ERROR, { code: 'aiGenerationFailed' });
    }, 20);

    expect((await following).map((item) => item.type === 'entry' && item.entry.event)).toEqual([
      AiStreamEventName.MESSAGE_START,
      AiStreamEventName.ERROR,
    ]);
  });

  it('should replay the saved answer when the stream has expired and reading starts from the beginning', async () => {
    repository.findById.mockResolvedValue(message());

    const replayed = await collect(service.follow('m1', '0', new AbortController().signal));

    expect(replayed.map((item) => item.type === 'entry' && [item.entry.id, item.entry.event, item.entry.data])).toEqual(
      [
        [null, AiStreamEventName.MESSAGE_START, { messageId: 'm1' }],
        [null, AiStreamEventName.ANSWER_DELTA, { text: '完整回答' }],
        [null, AiStreamEventName.SUGGESTIONS, { items: ['追问'] }],
        [
          null,
          AiStreamEventName.MESSAGE_DONE,
          { status: AiMessageStatus.DONE, usage: { inputTokens: 3, outputTokens: 4 } },
        ],
      ],
    );
  });

  it('should report an expired stream when resuming after it has expired', async () => {
    repository.findById.mockResolvedValue(message());

    const items = await collect(service.follow('m1', '3-0', new AbortController().signal));

    expect(items).toEqual([
      { type: 'entry', entry: { id: null, event: AiStreamEventName.ERROR, data: { code: 'aiStreamExpired' } } },
    ]);
  });

  it('should send heartbeats while idle and give up after the follow timeout', async () => {
    Object.assign(AI_STREAM_TIMINGS, { heartbeatIntervalMs: 10, followTimeoutMs: 60 });
    await service.append('m1', AiStreamEventName.MESSAGE_START, { messageId: 'm1' });

    const items = await collect(service.follow('m1', '0', new AbortController().signal));

    expect(items.some((item) => item.type === 'heartbeat')).toBe(true);
    expect(items.at(-1)).toEqual({
      type: 'entry',
      entry: { id: null, event: AiStreamEventName.ERROR, data: { code: 'aiStreamTimeout' } },
    });
  });

  it('should aggregate delivered content into a snapshot', async () => {
    await service.append('m1', AiStreamEventName.MESSAGE_START, { messageId: 'm1' });
    await service.append('m1', AiStreamEventName.REASONING_DELTA, { text: '想' });
    await service.append('m1', AiStreamEventName.ANSWER_DELTA, { text: '答' });
    const lastId = await service.append('m1', AiStreamEventName.ANSWER_DELTA, { text: '案' });

    await expect(service.snapshot('m1')).resolves.toEqual({
      content: '答案',
      reasoning: '想',
      suggestions: null,
      lastEventId: lastId,
    });
    await expect(service.snapshot('missing')).resolves.toBeNull();
  });
});
