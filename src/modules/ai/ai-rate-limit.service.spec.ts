import { AiRateLimitService, DEFAULT_AI_RATE_PER_MINUTE } from './ai-rate-limit.service';
import { MemoryAiRealtimeStore } from './infrastructure/realtime/memory-ai-realtime.store';
import { AppConfigService } from '../config/config.service';

describe('AiRateLimitService', () => {
  let store: MemoryAiRealtimeStore;
  let limit: unknown;
  let service: AiRateLimitService;
  const at = (iso: string): Date => new Date(iso);

  beforeEach(() => {
    store = new MemoryAiRealtimeStore();
    limit = 2;
    const config = { getValue: vi.fn(() => Promise.resolve(limit)) };
    service = new AiRateLimitService(store, config as unknown as AppConfigService);
  });

  it('should allow requests up to ai.ratePerMinute within the same minute', async () => {
    await service.assertWithinRate(1, at('2026-10-18T02:00:01Z'));
    await service.assertWithinRate(1, at('2026-10-18T02:00:30Z'));

    await expect(service.assertWithinRate(1, at('2026-10-18T02:00:45Z'))).rejects.toMatchObject({
      errorKey: 'aiRateLimited',
      response: { errors: expect.objectContaining({ limit: 2, retryAfter: 15 }) },
    });
  });

  it('should count each user and each minute separately', async () => {
    await service.assertWithinRate(1, at('2026-10-18T02:00:01Z'));
    await service.assertWithinRate(1, at('2026-10-18T02:00:02Z'));

    await expect(service.assertWithinRate(2, at('2026-10-18T02:00:03Z'))).resolves.toBeUndefined();
    await expect(service.assertWithinRate(1, at('2026-10-18T02:01:00Z'))).resolves.toBeUndefined();
  });

  it('should fall back to the default limit when the config is invalid', async () => {
    limit = 'x';
    for (let index = 0; index < DEFAULT_AI_RATE_PER_MINUTE; index += 1) {
      await service.assertWithinRate(1, at('2026-10-18T02:00:01Z'));
    }

    await expect(service.assertWithinRate(1, at('2026-10-18T02:00:02Z'))).rejects.toMatchObject({
      errorKey: 'aiRateLimited',
    });
  });

  it('should answer aiUnavailable when the counter store is down', async () => {
    vi.spyOn(store, 'increment').mockRejectedValue(new Error('down'));

    await expect(service.assertWithinRate(1)).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });
});
