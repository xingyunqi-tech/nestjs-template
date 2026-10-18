export type AiUsageKind = 'chat' | 'grading';

export class AiUsageDaily {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  model: string;
  kind: AiUsageKind;
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  /** 命中上下文缓存的输入 token，已包含在 inputTokens 中 */
  cachedInputTokens: number;
  /** 估算成本（元） */
  cost: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AiUsageIncrement = Pick<
  AiUsageDaily,
  'date' | 'model' | 'kind' | 'requests' | 'failures' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cost'
>;
