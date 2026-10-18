import { UnprocessableEntityException } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiQuotaService } from './ai-quota.service';
import { AiUsageDailyRepository } from './infrastructure/persistence/ai-usage-daily.repository';
import { AiUsageDaily } from './domain/ai-usage-daily';

describe('AiUsageService', () => {
  const row = (date: string, model: string, cost: number): AiUsageDaily =>
    Object.assign(new AiUsageDaily(), {
      date,
      model,
      kind: 'chat',
      requests: 3,
      failures: 1,
      inputTokens: 100,
      outputTokens: 50,
      cost,
    });
  let quota: { getStatus: ReturnType<typeof vi.fn> };
  let usage: { findRange: ReturnType<typeof vi.fn> };
  let service: AiUsageService;

  beforeEach(() => {
    quota = { getStatus: vi.fn().mockResolvedValue({ date: '2026-10-18', limit: 20, used: 3, remaining: 17 }) };
    usage = { findRange: vi.fn().mockResolvedValue([row('2026-10-17', 'a', 0.1), row('2026-10-18', 'b', 0.2)]) };
    service = new AiUsageService(quota as unknown as AiQuotaService, usage as unknown as AiUsageDailyRepository);
  });

  it('should return the chat quota of the day', async () => {
    await expect(service.getQuota(7)).resolves.toEqual({
      date: '2026-10-18',
      chat: { limit: 20, used: 3, remaining: 17 },
    });
    expect(quota.getStatus).toHaveBeenCalledWith(7, 'chat');
  });

  it('should return the usage by day and model with the totals of the range', async () => {
    const result = await service.findUsage('2026-10-12', '2026-10-18');

    expect(usage.findRange).toHaveBeenCalledWith('2026-10-12', '2026-10-18');
    expect(result.items).toEqual([
      expect.objectContaining({ date: '2026-10-17', model: 'a', kind: 'chat', requests: 3, failures: 1, cost: 0.1 }),
      expect.objectContaining({ date: '2026-10-18', model: 'b', inputTokens: 100, outputTokens: 50, cost: 0.2 }),
    ]);
    expect(result.total).toEqual({ requests: 6, failures: 2, inputTokens: 200, outputTokens: 100, cost: 0.3 });
  });

  it.each([
    ['2026-10-18', '2026-10-17'],
    ['2025-10-17', '2026-10-18'],
    ['2026-13-40', '2026-10-18'],
  ])('should reject the range %s to %s', async (from, to) => {
    await expect(service.findUsage(from, to)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(usage.findRange).not.toHaveBeenCalled();
  });
});
