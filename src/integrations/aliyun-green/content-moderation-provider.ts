export type ContentModerationKind = 'input' | 'output';

export interface ContentModerationParams {
  /** input 为用户输入，output 为模型输出 */
  kind: ContentModerationKind;
  content: string;
  userId: number;
  /** 关联同一回答的多次输出送检 */
  sessionId?: string;
}

export type ContentModerationVerdict = 'pass' | 'block';

export interface ContentModerationResult {
  verdict: ContentModerationVerdict;
  riskLevel: string;
  labels: string[];
  requestId: string;
}

export type ContentModerationErrorCode =
  'notConfigured' | 'contentTooLong' | 'timeout' | 'networkError' | 'upstreamError' | 'invalidResponse';

export class ContentModerationError extends Error {
  constructor(
    readonly code: ContentModerationErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ContentModerationError';
  }
}

export abstract class ContentModerationProvider {
  abstract isConfigured(): boolean;

  /** @throws ContentModerationError 未配置、内容超长或调用失败 */
  abstract moderate(params: ContentModerationParams): Promise<ContentModerationResult>;
}
