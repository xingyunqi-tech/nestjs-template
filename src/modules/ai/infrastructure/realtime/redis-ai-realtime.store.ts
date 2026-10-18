import { Logger, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { AiRealtimeStore } from './ai-realtime.store';
import { AiStreamEntry, AiStreamEventName } from '../../domain/ai-stream-event';

const INCREMENT_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value
`;

const INCREMENT_FLOAT_SCRIPT = `
local value = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return value
`;

const DECREMENT_SCRIPT = `
local value = tonumber(redis.call('GET', KEYS[1]) or '0')
if value > 0 then
  return redis.call('DECR', KEYS[1])
end
return value
`;

export class RedisAiRealtimeStore extends AiRealtimeStore implements OnModuleDestroy {
  private readonly logger = new Logger(RedisAiRealtimeStore.name);
  private readonly client: Redis;
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, ((message: string) => void)[]>();

  constructor(options: RedisOptions) {
    super();
    this.client = new Redis({ ...options, connectTimeout: 5000, commandTimeout: 3000, maxRetriesPerRequest: 1 });
    this.client.on('error', (error: Error) => this.logger.warn(`Redis AI store error: ${error.message}`));
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    return Number(await this.client.eval(INCREMENT_SCRIPT, 1, key, ttlSeconds));
  }

  async decrement(key: string): Promise<void> {
    await this.client.eval(DECREMENT_SCRIPT, 1, key);
  }

  async incrementFloat(key: string, amount: number, ttlSeconds: number): Promise<number> {
    return Number(await this.client.eval(INCREMENT_FLOAT_SCRIPT, 1, key, amount, ttlSeconds));
  }

  async getNumber(key: string): Promise<number> {
    return Number((await this.client.get(key)) ?? 0);
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async append(
    key: string,
    event: AiStreamEventName,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<string> {
    const results = await this.client
      .multi()
      .xadd(key, '*', 'event', event, 'data', JSON.stringify(data))
      .expire(key, ttlSeconds)
      .exec();
    const [error, id] = results?.[0] ?? [new Error('XADD returned no result'), null];
    if (error) {
      throw error;
    }
    return String(id);
  }

  async read(key: string, afterId: string, count: number): Promise<(AiStreamEntry & { id: string })[] | null> {
    const result = await this.client.xread('COUNT', count, 'STREAMS', key, afterId);
    const entries = result?.[0]?.[1] ?? [];
    if (entries.length === 0) {
      return (await this.client.exists(key)) ? [] : null;
    }
    return entries.map(([id, fields]) => {
      const values = new Map<string, string>();
      for (let index = 0; index + 1 < fields.length; index += 2) {
        values.set(fields[index], fields[index + 1]);
      }
      return {
        id,
        event: values.get('event') as AiStreamEventName,
        data: JSON.parse(values.get('data') ?? '{}') as Record<string, unknown>,
      };
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate({ commandTimeout: undefined, maxRetriesPerRequest: null });
      this.subscriber.on('error', (error: Error) => this.logger.warn(`Redis AI subscriber error: ${error.message}`));
      this.subscriber.on('message', (received: string, message: string) => {
        this.handlers.get(received)?.forEach((callback) => callback(message));
      });
    }
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.push(handler);
      return;
    }
    this.handlers.set(channel, [handler]);
    await this.subscriber.subscribe(channel);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.client.quit().catch(() => undefined), this.subscriber?.quit().catch(() => undefined)]);
  }
}
