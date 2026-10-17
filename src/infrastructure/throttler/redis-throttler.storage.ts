import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from '@prometheus-io/client';
import Redis from 'ioredis';
import { AllConfigType } from '../../config/config.type';
import { AlertLevel, AlertReporter } from '../alerting/alert-reporter';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

const COMMAND_TIMEOUT_MS = 500;

export const THROTTLER_FALLBACK_ALERT_KEY = 'throttler-storage-fallback';

/** 返回 [totalHits, 窗口剩余毫秒, 是否封禁, 封禁剩余毫秒] */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(ARGV[2]) + 1, blockTtl, 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  local block = tonumber(ARGV[3])
  if block <= 0 then
    block = ttl
  end
  redis.call('SET', KEYS[2], '1', 'PX', block)
  redis.call('DEL', KEYS[1])
  return {hits, ttl, 1, block}
end
return {hits, ttl, 0, 0}
`;

/** Redis 不可用时降级为本实例内存计数并告警 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: Redis | null;
  private readonly memory = new ThrottlerStorageService();
  private degraded = false;

  constructor(
    configService: ConfigService<AllConfigType>,
    private readonly alertReporter: AlertReporter,
    @InjectMetric('throttler_storage_fallback_total') private readonly fallbackTotal: Counter<string>,
  ) {
    if (!configService.get('redis.enabled', { infer: true })) {
      this.client = null;
      return;
    }

    this.client = new Redis({
      host: configService.get('redis.host', { infer: true }),
      port: configService.get('redis.port', { infer: true }),
      password: configService.get('redis.password', { infer: true }),
      db: configService.get('redis.db', { infer: true }),
      keyPrefix: 'throttle:',
      connectTimeout: 5000,
      commandTimeout: COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis throttler error: ${error.message}`);
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.client) {
      try {
        const record = await this.incrementInRedis(key, ttl, limit, blockDuration, throttlerName);
        this.markRecovered();
        return record;
      } catch (error) {
        this.markDegraded(error);
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  async onModuleDestroy(): Promise<void> {
    this.memory.onApplicationShutdown();
    await this.client?.quit().catch(() => undefined);
  }

  private async incrementInRedis(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `${key}:${throttlerName}`;
    const [totalHits, ttlMs, blocked, blockMs] = (await this.client!.eval(
      INCREMENT_SCRIPT,
      2,
      hitsKey,
      `${hitsKey}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits,
      timeToExpire: Math.ceil(ttlMs / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }

  private markDegraded(error: unknown): void {
    this.fallbackTotal.inc();
    if (this.degraded) {
      return;
    }
    this.degraded = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.error(`Redis throttler storage unavailable, falling back to in-memory storage: ${reason}`);
    void this.alertReporter.raise(
      'throttler',
      AlertLevel.CRITICAL,
      `限流存储 Redis 不可用，已降级为单实例内存计数：${reason}`,
      { reason },
      THROTTLER_FALLBACK_ALERT_KEY,
    );
  }

  private markRecovered(): void {
    if (this.degraded) {
      this.degraded = false;
      this.logger.log('Redis throttler storage recovered');
    }
  }
}
