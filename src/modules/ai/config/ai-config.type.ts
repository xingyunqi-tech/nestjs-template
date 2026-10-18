export type AiConfig = {
  /** 模型单价（元/百万 token），用于估算成本 */
  priceInputCacheHit: number;
  priceInputCacheMiss: number;
  priceOutput: number;
};
