import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'timers/promises';
import { AiRealtimeStore, aiMessageStreamKey } from './infrastructure/realtime/ai-realtime.store';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiStreamEntry, AiStreamEventName, isTerminalEvent } from './domain/ai-stream-event';
import { AiMessage, AiMessageStatus, AiMessageUsage } from './domain/ai-message';

export const AI_STREAM_TTL_SECONDS = 10 * 60;

export const AI_STREAM_TIMINGS = {
  pollIntervalMs: 250,
  heartbeatIntervalMs: 15_000,
  followTimeoutMs: 10 * 60_000,
};

const READ_BATCH = 100;
const SNAPSHOT_LIMIT = 10_000;

export type AiStreamFollowItem = { type: 'entry'; entry: AiStreamEntry } | { type: 'heartbeat' };

export interface AiStreamSnapshot {
  content: string;
  reasoning: string | null;
  suggestions: string[] | null;
  lastEventId: string | null;
}

export function publicUsage(usage: AiMessageUsage | null): { inputTokens: number; outputTokens: number } | null {
  return usage && { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

function errorEntry(code: string): AiStreamEntry {
  return { id: null, event: AiStreamEventName.ERROR, data: { code } };
}

/** 生成任务写入、SSE 连接读取的消息事件流（Redis Stream `ai:msg:{messageId}`） */
@Injectable()
export class AiMessageStreamService {
  constructor(
    private readonly store: AiRealtimeStore,
    private readonly messageRepository: AiMessageRepository,
  ) {}

  append(messageId: string, event: AiStreamEventName, data: Record<string, unknown>): Promise<string> {
    return this.store.append(aiMessageStreamKey(messageId), event, data, AI_STREAM_TTL_SECONDS);
  }

  /**
   * 从 afterId 之后续读，直到结束事件、连接中止或超时；空闲时产出心跳。
   * 流已过期时：从头读取则按数据库内容补发完整事件，否则产出 aiStreamExpired 错误；跟读超时产出 aiStreamTimeout 错误
   */
  async *follow(messageId: string, afterId: string, signal: AbortSignal): AsyncGenerator<AiStreamFollowItem> {
    const key = aiMessageStreamKey(messageId);
    const deadline = Date.now() + AI_STREAM_TIMINGS.followTimeoutMs;
    let cursor = afterId;
    let lastOutputAt = Date.now();
    while (!signal.aborted) {
      const entries = await this.store.read(key, cursor, READ_BATCH);
      if (entries === null) {
        const message = await this.messageRepository.findById(messageId);
        if (message?.status !== AiMessageStatus.STREAMING) {
          const replay = message && cursor === '0' ? this.replay(message) : [errorEntry('aiStreamExpired')];
          for (const entry of replay) {
            yield { type: 'entry', entry };
          }
          return;
        }
      } else {
        for (const entry of entries) {
          yield { type: 'entry', entry };
          cursor = entry.id;
          if (isTerminalEvent(entry.event)) {
            return;
          }
        }
        if (entries.length > 0) {
          lastOutputAt = Date.now();
        }
        if (entries.length === READ_BATCH) {
          continue;
        }
      }
      if (Date.now() >= deadline) {
        yield { type: 'entry', entry: errorEntry('aiStreamTimeout') };
        return;
      }
      if (Date.now() - lastOutputAt >= AI_STREAM_TIMINGS.heartbeatIntervalMs) {
        lastOutputAt = Date.now();
        yield { type: 'heartbeat' };
      }
      await delay(AI_STREAM_TIMINGS.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
  }

  /** 生成中的已下发内容；流不存在时返回 null */
  async snapshot(messageId: string): Promise<AiStreamSnapshot | null> {
    const entries = await this.store.read(aiMessageStreamKey(messageId), '0', SNAPSHOT_LIMIT);
    if (entries === null) {
      return null;
    }
    const snapshot: AiStreamSnapshot = { content: '', reasoning: null, suggestions: null, lastEventId: null };
    for (const entry of entries) {
      const text = typeof entry.data.text === 'string' ? entry.data.text : '';
      if (entry.event === AiStreamEventName.ANSWER_DELTA) {
        snapshot.content += text;
      } else if (entry.event === AiStreamEventName.REASONING_DELTA) {
        snapshot.reasoning = (snapshot.reasoning ?? '') + text;
      } else if (entry.event === AiStreamEventName.SUGGESTIONS && Array.isArray(entry.data.items)) {
        snapshot.suggestions = entry.data.items as string[];
      }
      snapshot.lastEventId = entry.id;
    }
    return snapshot;
  }

  /** 按数据库中的结果补发完整事件 */
  private replay(message: AiMessage): AiStreamEntry[] {
    const entries: AiStreamEntry[] = [
      { id: null, event: AiStreamEventName.MESSAGE_START, data: { messageId: message.id } },
    ];
    if (message.reasoning) {
      entries.push({ id: null, event: AiStreamEventName.REASONING_DELTA, data: { text: message.reasoning } });
    }
    if (message.content) {
      entries.push({ id: null, event: AiStreamEventName.ANSWER_DELTA, data: { text: message.content } });
    }
    if (message.suggestions && message.suggestions.length > 0) {
      entries.push({ id: null, event: AiStreamEventName.SUGGESTIONS, data: { items: message.suggestions } });
    }
    entries.push(
      message.status === AiMessageStatus.FAILED
        ? errorEntry('aiGenerationFailed')
        : {
            id: null,
            event: AiStreamEventName.MESSAGE_DONE,
            data: { status: message.status, usage: publicUsage(message.usage) },
          },
    );
    return entries;
  }
}
