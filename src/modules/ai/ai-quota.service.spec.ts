import { AiQuotaService } from './ai-quota.service';
import { MemoryAiRealtimeStore } from './infrastructure/realtime/memory-ai-realtime.store';
import { AiRealtimeStore, aiQuotaKey } from './infrastructure/realtime/ai-realtime.store';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

describe('AiQuotaService', () => {
  let store: MemoryAiRealtimeStore;
  let limit: unknown;
  let service: AiQuotaService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T15:59:00Z'));
    store = new MemoryAiRealtimeStore();
    limit = 2;
    const config = { getValue: vi.fn(() => Promise.resolve(limit)) };
    service = new AiQuotaService(store, config as unknown as AppConfigService);
  });

  afterEach(() => vi.useRealTimers());

  it('should consume the quota of the business date and return that date', async () => {
    await expect(service.consume(1, 'chat')).resolves.toBe('2026-10-18');

    await expect(store.getNumber(aiQuotaKey(1, '2026-10-18', 'chat'))).resolves.toBe(1);
  });

  it('should roll back the increment and reject when the limit is reached', async () => {
    await service.consume(1, 'chat');
    await service.consume(1, 'chat');

    const error = await service.consume(1, 'chat').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).errorKey).toBe('aiQuotaExceeded');
    await expect(service.getStatus(1, 'chat')).resolves.toEqual({
      date: '2026-10-18',
      limit: 2,
      used: 2,
      remaining: 0,
    });
  });

  it('should treat an invalid limit as no quota', async () => {
    limit = 'abc';

    await expect(service.consume(1, 'chat')).rejects.toMatchObject({ errorKey: 'aiQuotaExceeded' });
  });

  it('should refund the quota of the original date after midnight', async () => {
    const quotaDate = await service.consume(1, 'chat');
    vi.setSystemTime(new Date('2026-10-18T16:01:00Z'));
    await service.consume(1, 'chat');

    await service.refund(1, 'chat', quotaDate);

    await expect(store.getNumber(aiQuotaKey(1, '2026-10-18', 'chat'))).resolves.toBe(0);
    await expect(store.getNumber(aiQuotaKey(1, '2026-10-19', 'chat'))).resolves.toBe(1);
  });

  it('should not go below zero when refunding', async () => {
    await service.refund(1, 'chat', '2026-10-18');

    await expect(store.getNumber(aiQuotaKey(1, '2026-10-18', 'chat'))).resolves.toBe(0);
  });

  it('should answer aiUnavailable when the counter store fails', async () => {
    const failing = Object.assign(new MemoryAiRealtimeStore(), {
      increment: vi.fn().mockRejectedValue(new Error('down')),
    }) as AiRealtimeStore;
    const config = { getValue: vi.fn().mockResolvedValue(2) };
    const failingService = new AiQuotaService(failing, config as unknown as AppConfigService);

    await expect(failingService.consume(1, 'chat')).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });

  it('should remove the quota counters of the user that may still exist', async () => {
    await store.increment(aiQuotaKey(1, '2026-10-16', 'chat'), 60);
    await store.increment(aiQuotaKey(1, '2026-10-17', 'grading'), 60);
    await service.consume(1, 'chat');
    await service.consume(2, 'chat');

    await service.clear(1);

    for (const key of [
      aiQuotaKey(1, '2026-10-16', 'chat'),
      aiQuotaKey(1, '2026-10-17', 'grading'),
      aiQuotaKey(1, '2026-10-18', 'chat'),
    ]) {
      await expect(store.getNumber(key)).resolves.toBe(0);
    }
    await expect(store.getNumber(aiQuotaKey(2, '2026-10-18', 'chat'))).resolves.toBe(1);
  });

  it('should answer aiUnavailable when the quota cannot be read', async () => {
    vi.spyOn(store, 'getNumber').mockRejectedValue(new Error('down'));

    await expect(service.getStatus(1, 'chat')).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });
});
