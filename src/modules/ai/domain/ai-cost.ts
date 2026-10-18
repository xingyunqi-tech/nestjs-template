export interface AiTokenPrices {
  /** 元/百万 token */
  inputCacheHit: number;
  inputCacheMiss: number;
  output: number;
}

export interface AiTokenUsage {
  /** 含 cachedInputTokens */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

const PER_MILLION = 1_000_000;

/** 估算成本（元），保留 6 位小数 */
export function estimateCost(usage: AiTokenUsage, prices: AiTokenPrices): number {
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cost =
    (cached * prices.inputCacheHit +
      (usage.inputTokens - cached) * prices.inputCacheMiss +
      usage.outputTokens * prices.output) /
    PER_MILLION;
  return Math.round(cost * PER_MILLION) / PER_MILLION;
}

/** 上游未返回用量时按字数估算 token 数 */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length * 0.6);
}
