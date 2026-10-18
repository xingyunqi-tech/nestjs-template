import type { ConfigType } from '@nestjs/config';
import llmConfig from '../config/llm.config';
import { LlmError, LlmStreamChunk } from '../llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible-llm.provider';

function createProvider(overrides: Partial<ConfigType<typeof llmConfig>> = {}) {
  return new OpenAiCompatibleLlmProvider({
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    timeoutMs: 120_000,
    ...overrides,
  });
}

const encoder = new TextEncoder();

function sseResponse(parts: string[], init: ResponseInit = { status: 200 }): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
  return new Response(stream, init);
}

/** 先输出 parts，之后保持打开，直到请求 signal 中止 */
function pendingSseResponse(parts: string[], signal: AbortSignal | null | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      signal?.addEventListener('abort', () => controller.error(signal.reason));
    },
  });
  return new Response(stream, { status: 200 });
}

function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason as Error));
  });
}

function dataEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function delta(fields: Record<string, unknown>, finishReason: string | null = null): string {
  return dataEvent({ model: 'deepseek-chat', choices: [{ index: 0, delta: fields, finish_reason: finishReason }] });
}

function usageEvent(usage: Record<string, unknown>, model = 'deepseek-chat'): string {
  return dataEvent({ model, choices: [], usage });
}

const DONE = 'data: [DONE]\n\n';

async function consume(
  iterable: AsyncIterable<LlmStreamChunk>,
  onChunk?: (chunk: LlmStreamChunk) => void,
): Promise<{ chunks: LlmStreamChunk[]; error?: unknown }> {
  const chunks: LlmStreamChunk[] = [];
  try {
    for await (const chunk of iterable) {
      chunks.push(chunk);
      onChunk?.(chunk);
    }
    return { chunks };
  } catch (error) {
    return { chunks, error };
  }
}

async function collect(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
  const { chunks, error } = await consume(iterable);
  if (error) {
    throw error as Error;
  }
  return chunks;
}

const params = { system: 's', messages: [] };

describe('OpenAiCompatibleLlmProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send a streaming chat completion request', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'ok' }, 'stop'), DONE]));
    const controller = new AbortController();

    await collect(
      createProvider({ baseUrl: 'https://api.deepseek.com/' }).streamChat({
        system: 'You are a tutor',
        messages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
          { role: 'user', content: 'Q2' },
        ],
        maxTokens: 1024,
        signal: controller.signal,
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a tutor' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 1024,
    });
    expect(init.signal?.aborted).toBe(false);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('should omit max_tokens when not provided', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'a' }, 'stop'), DONE]));

    await collect(createProvider().streamChat(params));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('should map reasoning_content, content, usage and finish_reason to chunks', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ': keep-alive\n\n',
        delta({ role: 'assistant', content: '', reasoning_content: '思考' }),
        delta({ reasoning_content: '中' }),
        delta({ content: '答案' }),
        delta({ content: '。' }, 'stop'),
        usageEvent({ prompt_tokens: 120, completion_tokens: 30, prompt_cache_hit_tokens: 100 }, 'deepseek-reasoner'),
        DONE,
      ]),
    );

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'reasoning', text: '思考' },
      { type: 'reasoning', text: '中' },
      { type: 'answer', text: '答案' },
      { type: 'answer', text: '。' },
      { type: 'usage', model: 'deepseek-reasoner', inputTokens: 120, outputTokens: 30, cachedInputTokens: 100 },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['content_filter', 'contentFilter'],
    ['tool_calls', 'other'],
  ])('should map finish_reason %s to %s', async (upstream, expected) => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'a' }, upstream), DONE]));

    const chunks = await collect(createProvider().streamChat(params));

    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: expected });
  });

  it('should report finish reason other when [DONE] arrives without finish_reason', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'a' }), DONE]));

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: 'a' },
      { type: 'finish', finishReason: 'other' },
    ]);
  });

  it('should complete when finish_reason is received without [DONE]', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'a' }, 'length')]));

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: 'a' },
      { type: 'finish', finishReason: 'length' },
    ]);
  });

  it('should throw upstreamError on finish_reason insufficient_system_resource', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([delta({ content: 'a' }), delta({ content: '' }, 'insufficient_system_resource'), DONE]),
    );

    const { chunks, error } = await consume(createProvider().streamChat(params));

    expect(chunks).toEqual([{ type: 'answer', text: 'a' }]);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'upstreamError' });
  });

  it('should read cached tokens from prompt_tokens_details', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        delta({ content: 'a' }, 'stop'),
        usageEvent({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } }, 'other'),
        DONE,
      ]),
    );

    const chunks = await collect(createProvider().streamChat(params));

    expect(chunks.find((chunk) => chunk.type === 'usage')).toEqual({
      type: 'usage',
      model: 'other',
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 4,
    });
  });

  it('should not yield usage when the stream has none', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'a' }, 'stop'), DONE]));

    const chunks = await collect(createProvider().streamChat(params));

    expect(chunks.some((chunk) => chunk.type === 'usage')).toBe(false);
  });

  it('should yield only the last usage once at the end of the stream', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        usageEvent({ prompt_tokens: 10, completion_tokens: 0 }),
        delta({ content: 'a' }, 'stop'),
        usageEvent({ prompt_tokens: 10, completion_tokens: 5 }),
        DONE,
      ]),
    );

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: 'a' },
      { type: 'usage', model: 'deepseek-chat', inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('should parse events split across network chunks and multi-byte characters', async () => {
    const encoded = encoder.encode(`${delta({ content: '你好' }, 'stop')}data: [DONE]\r\n\r\n`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < encoded.length; i += 7) {
          controller.enqueue(encoded.slice(i, i + 7));
        }
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: '你好' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('should accept data fields without a space after the colon', async () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: 'a' }, finish_reason: 'stop' }] });
    fetchMock.mockResolvedValueOnce(sseResponse([`data:${payload}\n\n`, 'data:[DONE]\n\n']));

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: 'a' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('should join multi-line data fields with newlines', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"a"},\ndata: "finish_reason":"stop"}]}\n\n', DONE]),
    );

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: 'a' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('should discard a trailing event that is not terminated by a blank line', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([delta({ content: 'a' }, 'stop'), 'data: {"choices":[{"delta":{"content":"tail"}}]}\n']),
    );

    await expect(collect(createProvider().streamChat(params))).resolves.toEqual([
      { type: 'answer', text: 'a' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('should throw notConfigured without an API key', async () => {
    await expect(collect(createProvider({ apiKey: '' }).streamChat(params))).rejects.toMatchObject({
      code: 'notConfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should throw httpError with status on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 }));

    const { error } = await consume(createProvider().streamChat(params));

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'httpError', status: 402 });
  });

  it('should throw upstreamError when the stream carries an error payload', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([delta({ content: 'a' }), dataEvent({ error: { message: 'overloaded', code: 'server_error' } })]),
    );

    await expect(collect(createProvider().streamChat(params))).rejects.toMatchObject({ code: 'upstreamError' });
  });

  it('should throw invalidResponse on malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {not json}\n\n']));

    await expect(collect(createProvider().streamChat(params))).rejects.toMatchObject({ code: 'invalidResponse' });
  });

  it('should throw incompleteStream when the stream ends without finish_reason or [DONE]', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: 'partial' })]));

    const { chunks, error } = await consume(createProvider().streamChat(params));

    expect(chunks).toEqual([{ type: 'answer', text: 'partial' }]);
    expect(error).toMatchObject({ code: 'incompleteStream' });
  });

  it('should wrap a rejected fetch as networkError with the original cause', async () => {
    const cause = new TypeError('fetch failed');
    fetchMock.mockRejectedValueOnce(cause);

    const { error } = await consume(createProvider().streamChat(params));

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'networkError', cause });
  });

  it('should wrap a failed body read as networkError with the original cause', async () => {
    const cause = new Error('socket hang up');
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(delta({ content: 'first' })));
          },
          pull(controller) {
            controller.error(cause);
          },
        }),
        { status: 200 },
      ),
    );

    const { chunks, error } = await consume(createProvider().streamChat(params));

    expect(chunks).toEqual([{ type: 'answer', text: 'first' }]);
    expect(error).toMatchObject({ code: 'networkError', cause });
  });

  it('should throw aborted when the signal aborts before the response arrives', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url, init) => rejectOnAbort(init?.signal));

    const pending = consume(createProvider().streamChat({ ...params, signal: controller.signal }));
    controller.abort();
    const { error } = await pending;

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'aborted' });
  });

  it('should throw aborted when the signal aborts during streaming', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url, init) =>
      Promise.resolve(pendingSseResponse([delta({ content: 'first' })], init?.signal)),
    );

    const { chunks, error } = await consume(createProvider().streamChat({ ...params, signal: controller.signal }), () =>
      controller.abort(),
    );

    expect(chunks).toEqual([{ type: 'answer', text: 'first' }]);
    expect(error).toMatchObject({ code: 'aborted', cause: { name: 'AbortError' } });
  });

  it('should throw timeout when the response does not arrive within the configured time', async () => {
    fetchMock.mockImplementationOnce((_url, init) => rejectOnAbort(init?.signal));

    const { error } = await consume(
      createProvider({ timeoutMs: 20 }).streamChat({ ...params, signal: new AbortController().signal }),
    );

    expect(error).toMatchObject({ code: 'timeout', cause: { name: 'TimeoutError' } });
  });

  it('should throw timeout when the stream stalls past the configured time', async () => {
    fetchMock.mockImplementationOnce((_url, init) =>
      Promise.resolve(pendingSseResponse([delta({ content: 'first' })], init?.signal)),
    );

    const { chunks, error } = await consume(createProvider({ timeoutMs: 20 }).streamChat(params));

    expect(chunks).toEqual([{ type: 'answer', text: 'first' }]);
    expect(error).toMatchObject({ code: 'timeout' });
  });

  it('should cancel the upstream body when the consumer stops iterating', async () => {
    let cancelled = false;
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(delta({ content: 'first' })));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      ),
    );

    for await (const chunk of createProvider().streamChat(params)) {
      expect(chunk).toEqual({ type: 'answer', text: 'first' });
      break;
    }

    expect(cancelled).toBe(true);
  });
});
