import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ServerError } from '@alicloud/openapi-core';
import aliyunGreenConfig from '../config/aliyun-green.config';
import { ContentModerationError } from '../content-moderation-provider';
import { ALIYUN_GREEN_TIMEOUT_MS, AliyunGreenModerationProvider } from './aliyun-green-moderation.provider';

const sdk = vi.hoisted(() => ({
  configs: [] as unknown[],
  textModerationPlus: vi.fn(),
}));

vi.mock('@alicloud/green20220302', async (importOriginal) => {
  const original = await importOriginal<typeof import('@alicloud/green20220302')>();
  class FakeGreen {
    constructor(config: unknown) {
      sdk.configs.push(config);
    }

    textModerationPlus(request: unknown): Promise<unknown> {
      return sdk.textModerationPlus(request) as Promise<unknown>;
    }
  }
  return { ...original, default: FakeGreen };
});

function createProvider(overrides: Partial<ConfigType<typeof aliyunGreenConfig>> = {}) {
  return new AliyunGreenModerationProvider({
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    region: 'cn-shanghai',
    ...overrides,
  });
}

function respond(riskLevel: string | undefined, labels: string[] = [], code = 200) {
  sdk.textModerationPlus.mockResolvedValue({
    statusCode: 200,
    body: {
      code,
      message: code === 200 ? 'OK' : 'failed',
      requestId: 'req-1',
      data: { riskLevel, result: labels.map((label) => ({ label })) },
    },
  });
}

function sentRequest(): { service: string; serviceParameters: Record<string, unknown> } {
  const request = sdk.textModerationPlus.mock.calls[0][0] as { service: string; serviceParameters: string };
  return { service: request.service, serviceParameters: JSON.parse(request.serviceParameters) };
}

async function moderationError(promise: Promise<unknown>): Promise<ContentModerationError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ContentModerationError);
  return error as ContentModerationError;
}

describe('AliyunGreenModerationProvider', () => {
  beforeEach(() => {
    sdk.configs.length = 0;
    sdk.textModerationPlus.mockReset();
  });

  it('should create the client on the regional endpoint with 3 second timeouts', () => {
    const provider = createProvider({ region: 'cn-beijing' });

    expect(provider.isConfigured()).toBe(true);
    expect(sdk.configs[0]).toMatchObject({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      regionId: 'cn-beijing',
      endpoint: 'green-cip.cn-beijing.aliyuncs.com',
      connectTimeout: ALIYUN_GREEN_TIMEOUT_MS,
      readTimeout: ALIYUN_GREEN_TIMEOUT_MS,
    });
    expect(sdk.configs[0]).not.toHaveProperty('retryOptions');
    expect(ALIYUN_GREEN_TIMEOUT_MS).toBe(3000);
  });

  it('should trim the credentials', () => {
    createProvider({ accessKeyId: ' ak ', accessKeySecret: '\tsk\n' });

    expect(sdk.configs[0]).toMatchObject({ accessKeyId: 'ak', accessKeySecret: 'sk' });
  });

  it.each([[{ accessKeySecret: '' }], [{ accessKeyId: '' }], [{ accessKeyId: '   ' }]])(
    'should warn without the values and stay not configured when only one credential is set: %o',
    (overrides) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const provider = createProvider(overrides);

      expect(provider.isConfigured()).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toMatch(/\bak\b|\bsk\b/);
      warn.mockRestore();
    },
  );

  it('should stay not configured without warning when both credentials are blank', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const provider = createProvider({ accessKeyId: ' ', accessKeySecret: '' });

    expect(provider.isConfigured()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('should send input to llm_query_moderation with the user id as accountId', async () => {
    respond('none', ['nonLabel']);

    await expect(createProvider().moderate({ kind: 'input', content: '为什么选 B？', userId: 7 })).resolves.toEqual({
      verdict: 'pass',
      riskLevel: 'none',
      labels: [],
      requestId: 'req-1',
    });
    expect(sentRequest()).toEqual({
      service: 'llm_query_moderation',
      serviceParameters: { content: '为什么选 B？', accountId: '7' },
    });
  });

  it('should send output to llm_response_moderation with the session id', async () => {
    respond('none');

    await createProvider().moderate({ kind: 'output', content: '答案是 B', userId: 7, sessionId: 'message-1' });

    expect(sentRequest()).toEqual({
      service: 'llm_response_moderation',
      serviceParameters: { content: '答案是 B', sessionId: 'message-1' },
    });
  });

  it.each([
    ['high', 'block'],
    ['medium', 'block'],
    ['low', 'pass'],
    ['none', 'pass'],
  ])('should map risk level %s to %s', async (riskLevel, verdict) => {
    respond(riskLevel, ['political_content', 'contraband']);

    await expect(createProvider().moderate({ kind: 'output', content: 'x', userId: 1 })).resolves.toEqual({
      verdict,
      riskLevel,
      labels: ['political_content', 'contraband'],
      requestId: 'req-1',
    });
  });

  it('should reject without calling the service when credentials are not configured', async () => {
    const provider = createProvider({ accessKeySecret: '' });

    expect(provider.isConfigured()).toBe(false);
    const error = await moderationError(provider.moderate({ kind: 'input', content: 'x', userId: 1 }));
    expect(error.code).toBe('notConfigured');
    expect(sdk.configs).toEqual([]);
  });

  it.each([
    ['input', 2000],
    ['output', 5000],
  ] as const)('should reject %s content longer than %i characters without calling the service', async (kind, max) => {
    respond('none');
    const provider = createProvider();

    await provider.moderate({ kind, content: 'a'.repeat(max), userId: 1 });
    const error = await moderationError(provider.moderate({ kind, content: 'a'.repeat(max + 1), userId: 1 }));

    expect(error.code).toBe('contentTooLong');
    expect(sdk.textModerationPlus).toHaveBeenCalledTimes(1);
  });

  it('should report a timeout once without retrying', async () => {
    const timeout = Object.assign(new Error('ReadTimeout: 3000. POST / failed.'), { name: 'RequestTimeoutError' });
    sdk.textModerationPlus.mockRejectedValue(timeout);

    const error = await moderationError(createProvider().moderate({ kind: 'input', content: 'x', userId: 1 }));

    expect(error.code).toBe('timeout');
    expect(error.cause).toBe(timeout);
    expect(sdk.textModerationPlus).toHaveBeenCalledTimes(1);
  });

  it('should report network errors', async () => {
    sdk.textModerationPlus.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const error = await moderationError(createProvider().moderate({ kind: 'input', content: 'x', userId: 1 }));

    expect(error.code).toBe('networkError');
  });

  it('should report service errors with the error code', async () => {
    sdk.textModerationPlus.mockRejectedValue(
      new ServerError({ statusCode: 403, code: 'InvalidAccessKeyId.NotFound', message: 'not found', requestId: 'r' }),
    );

    const error = await moderationError(createProvider().moderate({ kind: 'input', content: 'x', userId: 1 }));

    expect(error.code).toBe('upstreamError');
    expect(error.message).toContain('InvalidAccessKeyId.NotFound');
  });

  it('should recognize service errors by their statusCode and code fields', async () => {
    const serviceError = Object.assign(new Error('throttled'), {
      statusCode: 429,
      code: 'Throttling.User',
      requestId: 'r2',
    });
    sdk.textModerationPlus.mockRejectedValue(serviceError);

    const error = await moderationError(createProvider().moderate({ kind: 'input', content: 'x', userId: 1 }));

    expect(error.code).toBe('upstreamError');
    expect(error.message).toContain('429 Throttling.User');
    expect(error.message).toContain('request=r2');
  });

  it('should treat errors with a non-numeric statusCode as network errors', async () => {
    sdk.textModerationPlus.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    const error = await moderationError(createProvider().moderate({ kind: 'input', content: 'x', userId: 1 }));

    expect(error.code).toBe('networkError');
  });

  it('should report a non-200 response code', async () => {
    respond(undefined, [], 408);

    const error = await moderationError(createProvider().moderate({ kind: 'input', content: 'x', userId: 1 }));

    expect(error.code).toBe('upstreamError');
    expect(error.message).toContain('408');
  });

  it.each([undefined, 'unknown'])('should reject the risk level %s as an invalid response', async (riskLevel) => {
    respond(riskLevel);

    const error = await moderationError(createProvider().moderate({ kind: 'output', content: 'x', userId: 1 }));

    expect(error.code).toBe('invalidResponse');
  });
});
