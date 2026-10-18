import { Repository } from 'typeorm';
import { AiUsageDailyRelationalRepository } from './ai-usage-daily.repository';
import { AiUsageDailyEntity } from '../entities/ai-usage-daily.entity';

describe('AiUsageDailyRelationalRepository', () => {
  it('should upsert the daily usage and accumulate the cached input tokens alongside the input tokens', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new AiUsageDailyRelationalRepository({ query } as unknown as Repository<AiUsageDailyEntity>);

    await repository.increment({
      date: '2026-10-18',
      model: 'deepseek-chat',
      kind: 'chat',
      requests: 1,
      failures: 0,
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 400,
      cost: 0.0034,
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT ("date", "model", "kind") DO UPDATE');
    expect(sql).toContain('"inputTokens" = "ai_usage_daily"."inputTokens" + EXCLUDED."inputTokens"');
    expect(sql).toContain('"cachedInputTokens" = "ai_usage_daily"."cachedInputTokens" + EXCLUDED."cachedInputTokens"');
    expect(params).toEqual(['2026-10-18', 'deepseek-chat', 'chat', 1, 0, 1000, 200, 400, 0.0034]);
  });
});
