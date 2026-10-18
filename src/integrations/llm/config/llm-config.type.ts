export type LlmConfig = {
  /** OpenAI 兼容接口地址，不含 /chat/completions */
  baseUrl: string;
  apiKey: string;
  /** 模型标识 */
  model: string;
  /** 单次请求总时长上限（毫秒） */
  timeoutMs: number;
};
