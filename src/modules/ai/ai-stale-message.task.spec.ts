import type { Mocked } from 'vitest';
import { AI_STALE_STREAMING_MS, AiStaleMessageTask } from './ai-stale-message.task';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiQuotaService } from './ai-quota.service';
import { AiGenerationService } from './ai-generation.service';
import { AiMessageStatus } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('AiStaleMessageTask', () => {
  const now = new Date('2026-10-18T16:01:00Z');
  let schedulerService: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let messages: { findStaleStreaming: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> };
  let stream: { snapshot: ReturnType<typeof vi.fn>; append: ReturnType<typeof vi.fn> };
  let quota: { refund: ReturnType<typeof vi.fn> };
  let generation: { requestStop: ReturnType<typeof vi.fn> };
  let task: AiStaleMessageTask;

  beforeEach(() => {
    schedulerService = {
      runExclusive: vi.fn(async (_key, _ttl, work: () => Promise<unknown>) => ({
        executed: true,
        result: await work(),
      })),
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    } as never;
    messages = {
      findStaleStreaming: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'm1', userId: 7, quotaDate: '2026-10-18' },
          { id: 'm2', userId: 8, quotaDate: '2026-10-18' },
        ])
        .mockResolvedValue([]),
      finish: vi.fn().mockResolvedValue(true),
    };
    stream = {
      snapshot: vi
        .fn()
        .mockResolvedValue({ content: '已下发', reasoning: null, suggestions: null, lastEventId: '3-0' }),
      append: vi.fn().mockResolvedValue('4-0'),
    };
    quota = { refund: vi.fn().mockResolvedValue(undefined) };
    generation = { requestStop: vi.fn().mockResolvedValue(undefined) };
    task = new AiStaleMessageTask(
      schedulerService as unknown as SchedulerService,
      messages as unknown as AiMessageRepository,
      stream as unknown as AiMessageStreamService,
      quota as unknown as AiQuotaService,
      generation as unknown as AiGenerationService,
    );
  });

  it('should fail messages streaming for more than 5 minutes and refund the quota of their quota date', async () => {
    await expect(task.failStaleMessages(now)).resolves.toBe(2);

    expect(messages.findStaleStreaming).toHaveBeenCalledWith(new Date(now.getTime() - AI_STALE_STREAMING_MS), 100);
    expect(messages.finish).toHaveBeenCalledWith('m1', {
      content: '已下发',
      reasoning: null,
      suggestions: null,
      status: AiMessageStatus.FAILED,
      usage: null,
    });
    expect(quota.refund).toHaveBeenCalledWith(7, 'chat', '2026-10-18');
    expect(quota.refund).toHaveBeenCalledWith(8, 'chat', '2026-10-18');
    expect(stream.append).toHaveBeenCalledWith('m1', AiStreamEventName.ERROR, { code: 'aiGenerationFailed' });
    expect(generation.requestStop).toHaveBeenCalledWith('m1');
  });

  it('should not refund a message already finished by its generation task', async () => {
    messages.finish.mockResolvedValueOnce(false);

    await expect(task.failStaleMessages(now)).resolves.toBe(1);
    expect(quota.refund).toHaveBeenCalledTimes(1);
    expect(quota.refund).toHaveBeenCalledWith(8, 'chat', '2026-10-18');
  });

  it('should save an empty answer when the event stream is unavailable', async () => {
    stream.snapshot.mockRejectedValue(new Error('redis down'));

    await task.failStaleMessages(now);

    expect(messages.finish).toHaveBeenCalledWith('m1', expect.objectContaining({ content: '', reasoning: null }));
  });

  it('should run exclusively and log errors without throwing', async () => {
    await task.handle();
    expect(schedulerService.runExclusive).toHaveBeenCalledWith(
      'ai-stale-message',
      expect.any(Number),
      expect.any(Function),
    );
    expect(schedulerService.logTaskExecution).toHaveBeenCalledTimes(1);

    messages.findStaleStreaming.mockRejectedValue(new Error('db down'));
    await expect(task.handle()).resolves.toBeUndefined();
    expect(schedulerService.logTaskError).toHaveBeenCalledTimes(1);
  });

  it('should keep failing the other messages when one of them cannot be saved', async () => {
    messages.finish.mockRejectedValueOnce(new Error('db down'));

    await expect(task.failStaleMessages(now)).resolves.toBe(1);
    expect(messages.finish).toHaveBeenCalledWith('m2', expect.objectContaining({ status: AiMessageStatus.FAILED }));
    expect(quota.refund).toHaveBeenCalledTimes(1);
    expect(quota.refund).toHaveBeenCalledWith(8, 'chat', '2026-10-18');
  });

  it('should stop scanning when every message of a full batch fails', async () => {
    const batch = Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, userId: 7, quotaDate: '2026-10-18' }));
    messages.findStaleStreaming.mockReset().mockResolvedValue(batch);
    messages.finish.mockRejectedValue(new Error('db down'));

    await expect(task.failStaleMessages(now)).resolves.toBe(0);
    expect(messages.findStaleStreaming).toHaveBeenCalledTimes(1);
  });
});
