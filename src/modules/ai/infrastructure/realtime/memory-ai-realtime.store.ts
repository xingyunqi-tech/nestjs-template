import { EventEmitter } from 'events';
import { AiRealtimeStore } from './ai-realtime.store';
import { AiStreamEntry, AiStreamEventName } from '../../domain/ai-stream-event';

interface Expiring {
  expiresAt: number;
}

interface MemoryCounter extends Expiring {
  value: number;
}

interface MemoryStream extends Expiring {
  sequence: number;
  entries: (AiStreamEntry & { id: string })[];
}

const SWEEP_INTERVAL_MS = 60_000;

function sequenceOf(id: string): number {
  return Number(id.split('-')[0]) || 0;
}

/** 未启用 Redis 时使用，仅在本实例内生效 */
export class MemoryAiRealtimeStore extends AiRealtimeStore {
  private readonly counters = new Map<string, MemoryCounter>();
  private readonly streams = new Map<string, MemoryStream>();
  private readonly emitter = new EventEmitter();
  private lastSweepAt = Date.now();

  increment(key: string, ttlSeconds: number): Promise<number> {
    return this.incrementFloat(key, 1, ttlSeconds);
  }

  decrement(key: string): Promise<void> {
    const counter = this.live(this.counters, key);
    if (counter && counter.value > 0) {
      counter.value -= 1;
    }
    return Promise.resolve();
  }

  incrementFloat(key: string, amount: number, ttlSeconds: number): Promise<number> {
    this.sweep();
    const counter = this.live(this.counters, key) ?? { value: 0, expiresAt: Date.now() + ttlSeconds * 1000 };
    counter.value += amount;
    this.counters.set(key, counter);
    return Promise.resolve(counter.value);
  }

  getNumber(key: string): Promise<number> {
    return Promise.resolve(this.live(this.counters, key)?.value ?? 0);
  }

  append(key: string, event: AiStreamEventName, data: Record<string, unknown>, ttlSeconds: number): Promise<string> {
    this.sweep();
    const stream = this.live(this.streams, key) ?? { sequence: 0, entries: [], expiresAt: 0 };
    stream.sequence += 1;
    stream.expiresAt = Date.now() + ttlSeconds * 1000;
    const id = `${stream.sequence}-0`;
    stream.entries.push({ id, event, data: structuredClone(data) });
    this.streams.set(key, stream);
    return Promise.resolve(id);
  }

  read(key: string, afterId: string, count: number): Promise<(AiStreamEntry & { id: string })[] | null> {
    const stream = this.live(this.streams, key);
    if (!stream) {
      return Promise.resolve(null);
    }
    const after = sequenceOf(afterId);
    return Promise.resolve(stream.entries.filter((entry) => sequenceOf(entry.id) > after).slice(0, count));
  }

  publish(channel: string, message: string): Promise<void> {
    this.emitter.emit(channel, message);
    return Promise.resolve();
  }

  subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    this.emitter.on(channel, handler);
    return Promise.resolve();
  }

  /** 写入时每隔一段时间清理过期 key */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastSweepAt = now;
    for (const map of [this.counters, this.streams] as Map<string, Expiring>[]) {
      for (const [key, item] of map) {
        if (item.expiresAt <= now) {
          map.delete(key);
        }
      }
    }
  }

  private live<T extends Expiring>(map: Map<string, T>, key: string): T | undefined {
    const item = map.get(key);
    if (item && item.expiresAt <= Date.now()) {
      map.delete(key);
      return undefined;
    }
    return item;
  }
}
