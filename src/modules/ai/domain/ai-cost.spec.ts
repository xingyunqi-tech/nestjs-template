import { estimateCost } from './ai-cost';

describe('estimateCost', () => {
  it('should price cached input, uncached input and output separately per million tokens', () => {
    expect(
      estimateCost(
        { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 500_000 },
        { inputCacheHit: 0.5, inputCacheMiss: 2, output: 8 },
      ),
    ).toBe(0.2 + 1.2 + 4);
  });

  it('should not count more cached tokens than input tokens', () => {
    expect(
      estimateCost(
        { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 },
        { inputCacheHit: 1, inputCacheMiss: 10, output: 0 },
      ),
    ).toBe(0.0001);
  });
});
