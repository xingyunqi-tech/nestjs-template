export type LlmChatRole = 'user' | 'assistant';

export interface LlmChatMessage {
  role: LlmChatRole;
  content: string;
}

export interface LlmStreamChatParams {
  system: string;
  messages: LlmChatMessage[];
  maxTokens?: number;
  /** 中止时取消上游请求 */
  signal?: AbortSignal;
}

export interface LlmTextChunk {
  type: 'reasoning' | 'answer';
  text: string;
}

export interface LlmUsageChunk {
  type: 'usage';
  /** 上游实际使用的模型 */
  model: string;
  /** 含 cachedInputTokens */
  inputTokens: number;
  outputTokens: number;
  /** 命中上下文缓存的输入 token */
  cachedInputTokens: number;
}

export type LlmFinishReason = 'stop' | 'length' | 'contentFilter' | 'other';

/** 流的最后一块 */
export interface LlmFinishChunk {
  type: 'finish';
  finishReason: LlmFinishReason;
}

export type LlmStreamChunk = LlmTextChunk | LlmUsageChunk | LlmFinishChunk;

export type LlmErrorCode =
  | 'notConfigured'
  | 'aborted'
  | 'timeout'
  | 'networkError'
  | 'httpError'
  | 'upstreamError'
  | 'invalidResponse'
  | 'incompleteStream';

export class LlmError extends Error {
  readonly status?: number;

  constructor(
    readonly code: LlmErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'LlmError';
    this.status = options.status;
  }
}

export abstract class LlmProvider {
  /**
   * 流式对话：依次产出 reasoning / answer 文本块，结束时产出至多一个 usage 块和一个 finish 块
   * @throws LlmError code 为 aborted（调用方 signal 中止）、timeout（超过配置时长）、networkError（连接或读取失败，cause 为原始错误）、
   * notConfigured、httpError（附 status）、upstreamError、invalidResponse 或 incompleteStream
   */
  abstract streamChat(params: LlmStreamChatParams): AsyncIterable<LlmStreamChunk>;
}
