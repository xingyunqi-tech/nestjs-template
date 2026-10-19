import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Green, { TextModerationPlusRequest, TextModerationPlusResponse } from '@alicloud/green20220302';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import aliyunGreenConfig from '../config/aliyun-green.config';
import {
  ContentModerationError,
  ContentModerationKind,
  ContentModerationParams,
  ContentModerationProvider,
  ContentModerationResult,
} from '../content-moderation-provider';

export const ALIYUN_GREEN_TIMEOUT_MS = 3000;

const SERVICES: Record<ContentModerationKind, { service: string; maxLength: number }> = {
  input: { service: 'llm_query_moderation', maxLength: 2000 },
  output: { service: 'llm_response_moderation', maxLength: 5000 },
};

const BLOCKED_LEVELS = new Set(['high', 'medium']);

const PASSED_LEVELS = new Set(['low', 'none']);

const NO_LABEL = 'nonLabel';

interface ServiceError extends Error {
  statusCode: number;
  code: string;
  requestId?: string;
}

function isServiceError(error: unknown): error is ServiceError {
  return (
    error instanceof Error &&
    typeof (error as Partial<ServiceError>).statusCode === 'number' &&
    typeof (error as Partial<ServiceError>).code === 'string'
  );
}

/** 阿里云内容安全文本审核增强版（TextModerationPlus）；不重试 */
@Injectable()
export class AliyunGreenModerationProvider extends ContentModerationProvider {
  private readonly logger = new Logger(AliyunGreenModerationProvider.name);
  private readonly client: Green | null;

  constructor(
    @Inject(aliyunGreenConfig.KEY)
    config: ConfigType<typeof aliyunGreenConfig>,
  ) {
    super();
    const accessKeyId = config.accessKeyId.trim();
    const accessKeySecret = config.accessKeySecret.trim();
    if (Boolean(accessKeyId) !== Boolean(accessKeySecret)) {
      this.logger.warn('Only one of ALIYUN_GREEN_ACCESS_KEY_ID and ALIYUN_GREEN_ACCESS_KEY_SECRET is configured');
    }
    this.client =
      accessKeyId && accessKeySecret
        ? new Green(
            new $OpenApiUtil.Config({
              accessKeyId,
              accessKeySecret,
              regionId: config.region,
              endpoint: `green-cip.${config.region}.aliyuncs.com`,
              connectTimeout: ALIYUN_GREEN_TIMEOUT_MS,
              readTimeout: ALIYUN_GREEN_TIMEOUT_MS,
            }),
          )
        : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async moderate({ kind, content, userId, sessionId }: ContentModerationParams): Promise<ContentModerationResult> {
    if (!this.client) {
      throw new ContentModerationError('notConfigured', 'Aliyun Green credentials not configured');
    }
    const { service, maxLength } = SERVICES[kind];
    if (content.length > maxLength) {
      throw new ContentModerationError('contentTooLong', `${kind} content exceeds ${maxLength} characters`);
    }
    const parameters =
      kind === 'input' ? { content, accountId: String(userId) } : { content, ...(sessionId && { sessionId }) };

    let response: TextModerationPlusResponse;
    try {
      response = await this.client.textModerationPlus(
        new TextModerationPlusRequest({ service, serviceParameters: JSON.stringify(parameters) }),
      );
    } catch (error) {
      throw this.toError(error);
    }
    return this.toResult(response);
  }

  private toResult(response: TextModerationPlusResponse): ContentModerationResult {
    const body = response.body;
    const requestId = body?.requestId ?? '';
    if (body?.code !== 200) {
      throw new ContentModerationError(
        'upstreamError',
        `Aliyun Green responded ${body?.code ?? 'no code'} ${body?.message ?? ''} request=${requestId}`,
      );
    }
    const riskLevel = body.data?.riskLevel?.toLowerCase() ?? '';
    if (!BLOCKED_LEVELS.has(riskLevel) && !PASSED_LEVELS.has(riskLevel)) {
      throw new ContentModerationError(
        'invalidResponse',
        `Aliyun Green returned risk level "${riskLevel}" request=${requestId}`,
      );
    }
    const labels = (body.data?.result ?? [])
      .map((item) => item.label ?? '')
      .filter((label) => label !== '' && label !== NO_LABEL);
    if (riskLevel === 'low') {
      this.logger.log(`Low risk content passed: labels=${labels.join(',')} request=${requestId}`);
    }
    return { verdict: BLOCKED_LEVELS.has(riskLevel) ? 'block' : 'pass', riskLevel, labels, requestId };
  }

  private toError(error: unknown): ContentModerationError {
    if (isServiceError(error)) {
      return new ContentModerationError(
        'upstreamError',
        `Aliyun Green error ${error.statusCode} ${error.code}: ${error.message} request=${error.requestId ?? ''}`,
        { cause: error },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === 'RequestTimeoutError') {
      return new ContentModerationError('timeout', `Aliyun Green request timed out: ${message}`, { cause: error });
    }
    return new ContentModerationError('networkError', `Aliyun Green network error: ${message}`, { cause: error });
  }
}
