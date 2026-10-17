import { ConfigService } from '@nestjs/config';
import { Counter } from '@prometheus-io/client';
import { RedisThrottlerStorage, THROTTLER_FALLBACK_ALERT_KEY } from './redis-throttler.storage';
import { AlertLevel, AlertReporter } from '../alerting/alert-reporter';

const redis = vi.hoisted(() => ({
  eval: vi.fn(),
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(function () {
    return redis;
  }),
}));

function config(enabled: boolean): ConfigService {
  return { get: (key: string) => (key === 'redis.enabled' ? enabled : undefined) } as unknown as ConfigService;
}

describe('RedisThrottlerStorage', () => {
  let alertReporter: { raise: ReturnType<typeof vi.fn> };
  let fallbackTotal: { inc: ReturnType<typeof vi.fn> };
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    redis.eval.mockReset();
    alertReporter = { raise: vi.fn().mockResolvedValue(null) };
    fallbackTotal = { inc: vi.fn() };
    storage = new RedisThrottlerStorage(
      config(true),
      alertReporter as unknown as AlertReporter,
      fallbackTotal as unknown as Counter<string>,
    );
  });

  afterEach(async () => {
    await storage.onModuleDestroy();
  });

  it('should count hits in Redis and convert milliseconds to seconds', async () => {
    redis.eval.mockResolvedValue([2, 59_001, 0, 0]);

    await expect(storage.increment('key', 60_000, 5, 0, 'default')).resolves.toEqual({
      totalHits: 2,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 2, 'key:default', 'key:default:block', 60_000, 5, 0);
  });

  it('should report a blocked tracker from Redis', async () => {
    redis.eval.mockResolvedValue([6, 30_000, 1, 30_000]);

    await expect(storage.increment('key', 60_000, 5, 30_000, 'default')).resolves.toMatchObject({
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('should fall back to memory and raise one alert while Redis is unavailable', async () => {
    redis.eval.mockRejectedValue(new Error('Connection is closed.'));

    const first = await storage.increment('key', 60_000, 1, 0, 'default');
    const second = await storage.increment('key', 60_000, 1, 0, 'default');

    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(second.isBlocked).toBe(true);
    expect(fallbackTotal.inc).toHaveBeenCalledTimes(2);
    expect(alertReporter.raise).toHaveBeenCalledTimes(1);
    expect(alertReporter.raise).toHaveBeenCalledWith(
      'throttler',
      AlertLevel.CRITICAL,
      expect.any(String),
      { reason: 'Connection is closed.' },
      THROTTLER_FALLBACK_ALERT_KEY,
    );
  });

  it('should switch back to Redis after it recovers and alert again on the next outage', async () => {
    redis.eval.mockRejectedValueOnce(new Error('down'));
    await storage.increment('key', 60_000, 5, 0, 'default');

    redis.eval.mockResolvedValueOnce([1, 60_000, 0, 0]);
    await expect(storage.increment('key', 60_000, 5, 0, 'default')).resolves.toMatchObject({ totalHits: 1 });

    redis.eval.mockRejectedValueOnce(new Error('down again'));
    await storage.increment('key', 60_000, 5, 0, 'default');

    expect(alertReporter.raise).toHaveBeenCalledTimes(2);
  });

  it('should use memory without alerting when Redis is disabled', async () => {
    const memoryOnly = new RedisThrottlerStorage(
      config(false),
      alertReporter as unknown as AlertReporter,
      fallbackTotal as unknown as Counter<string>,
    );

    await expect(memoryOnly.increment('key', 60_000, 5, 0, 'default')).resolves.toMatchObject({ totalHits: 1 });
    expect(redis.eval).not.toHaveBeenCalled();
    expect(alertReporter.raise).not.toHaveBeenCalled();
    expect(fallbackTotal.inc).not.toHaveBeenCalled();
    await memoryOnly.onModuleDestroy();
  });
});
