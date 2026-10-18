import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import llmConfig from '../config/llm.config';
import {
  LlmError,
  LlmFinishReason,
  LlmProvider,
  LlmStreamChatParams,
  LlmStreamChunk,
  LlmUsageChunk,
} from '../llm-provider';

interface ChatCompletionChunk {
  model?: string;
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: { message?: string; code?: string | number };
}

const STREAM_DONE = '[DONE]';

const FINISH_REASONS: Record<string, LlmFinishReason> = {
  stop: 'stop',
  length: 'length',
  content_filter: 'contentFilter',
};

/** OpenAI 兼容协议（/chat/completions）流式实现 */
@Injectable()
export class OpenAiCompatibleLlmProvider extends LlmProvider {
  private readonly logger = new Logger(OpenAiCompatibleLlmProvider.name);

  constructor(
    @Inject(llmConfig.KEY)
    private readonly config: ConfigType<typeof llmConfig>,
  ) {
    super();
  }

  async *streamChat(params: LlmStreamChatParams): AsyncGenerator<LlmStreamChunk> {
    if (!this.config.apiKey) {
      throw new LlmError('notConfigured', 'LLM API key not configured');
    }

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;

    try {
      yield* this.request(params, signal);
    } catch (error) {
      if (params.signal?.aborted) {
        throw new LlmError('aborted', 'LLM request aborted', { cause: error });
      }
      if (timeoutSignal.aborted) {
        throw new LlmError('timeout', `LLM request timed out after ${this.config.timeoutMs}ms`, { cause: error });
      }
      if (error instanceof LlmError) {
        throw error;
      }
      this.logger.error(`LLM network error: ${error instanceof Error ? error.message : String(error)}`);
      throw new LlmError('networkError', 'LLM network error', { cause: error });
    }
  }

  private async *request(
    { system, messages, maxTokens }: LlmStreamChatParams,
    signal: AbortSignal,
  ): AsyncGenerator<LlmStreamChunk> {
    const { baseUrl, apiKey, model } = this.config;

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: true,
        stream_options: { include_usage: true },
        ...(maxTokens !== undefined && { max_tokens: maxTokens }),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`LLM request failed: ${response.status} ${detail.slice(0, 500)}`);
      throw new LlmError('httpError', `LLM request failed with status ${response.status}`, {
        status: response.status,
      });
    }

    let finishReason: LlmFinishReason | undefined;
    let usage: LlmUsageChunk | undefined;
    let done = false;

    for await (const data of readSseData(response.body)) {
      if (data === STREAM_DONE) {
        done = true;
        break;
      }

      let chunk: ChatCompletionChunk;
      try {
        chunk = JSON.parse(data) as ChatCompletionChunk;
      } catch {
        throw new LlmError('invalidResponse', 'LLM stream returned invalid JSON');
      }

      if (chunk.error) {
        this.logger.error(`LLM stream error: ${chunk.error.code ?? ''} ${chunk.error.message ?? ''}`);
        throw new LlmError('upstreamError', chunk.error.message ?? 'LLM stream error');
      }

      for (const choice of chunk.choices ?? []) {
        if (choice.delta?.reasoning_content) {
          yield { type: 'reasoning', text: choice.delta.reasoning_content };
        }
        if (choice.delta?.content) {
          yield { type: 'answer', text: choice.delta.content };
        }
        if (choice.finish_reason === 'insufficient_system_resource') {
          this.logger.error('LLM stream finished with insufficient_system_resource');
          throw new LlmError('upstreamError', 'LLM upstream has insufficient system resource');
        }
        if (choice.finish_reason) {
          finishReason = FINISH_REASONS[choice.finish_reason] ?? 'other';
        }
      }

      if (chunk.usage) {
        usage = {
          type: 'usage',
          model: chunk.model ?? model,
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cachedInputTokens:
            chunk.usage.prompt_cache_hit_tokens ?? chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }
    }

    if (!done && !finishReason) {
      throw new LlmError('incompleteStream', 'LLM stream ended unexpectedly');
    }

    if (usage) {
      yield usage;
    }
    yield { type: 'finish', finishReason: finishReason ?? 'other' };
  }
}

/** 按 SSE 规范分帧，逐个产出事件的 data 字段；流结束时未以空行收尾的事件丢弃 */
async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') {
          if (dataLines.length > 0) {
            yield dataLines.join('\n');
            dataLines = [];
          }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(line.startsWith('data: ') ? 6 : 5));
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
