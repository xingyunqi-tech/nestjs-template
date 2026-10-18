import type { Mocked } from 'vitest';
import { AI_BUDGET_ALERT_TYPE, AiBudgetService } from './ai-budget.service';
import { MemoryAiRealtimeStore } from './infrastructure/realtime/memory-ai-realtime.store';
import { aiBudgetAlertKey, aiCostKey } from './infrastructure/realtime/ai-realtime.store';
import { AiUsageDailyRepository } from './infrastructure/persistence/ai-usage-daily.repository';
import { AppConfigService } from '../config/config.service';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';

describe('AiBudgetService', () => {
  let store: MemoryAiRealtimeStore;
  let budget: unknown;
  let usageRepository: Mocked<AiUsageDailyRepository>;
  let alertReporter: { raise: ReturnType<typeof vi.fn> };
  let service: AiBudgetService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T02:00:00Z'));
    store = new MemoryAiRealtimeStore();
    budget = undefined;
    usageRepository = { increment: vi.fn().mockResolvedValue(undefined), findRange: vi.fn() };
    alertReporter = { raise: vi.fn().mockResolvedValue(null) };
    const config = { getValue: vi.fn(() => Promise.resolve(budget)) };
    service = new AiBudgetService(
      store,
      usageRepository,
      config as unknown as AppConfigService,
      { priceInputCacheHit: 0.5, priceInputCacheMiss: 2, priceOutput: 8 },
      alertReporter as unknown as AlertReporter,
    );
  });

  afterEach(() => vi.useRealTimers());

  it('should not trip the breaker when no budget is configured', async () => {
    await store.incrementFloat(aiCostKey('2026-10-18'), 1000, 60);

    await expect(service.assertWithinBudget()).resolves.toBeUndefined();
  });

  it('should trip the breaker once the cost of the day reaches the budget', async () => {
    budget = 1;
    await store.incrementFloat(aiCostKey('2026-10-18'), 0.99, 60);
    await expect(service.assertWithinBudget()).resolves.toBeUndefined();

    await store.incrementFloat(aiCostKey('2026-10-18'), 0.01, 60);

    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });

  it('should only count the cost of the current day', async () => {
    budget = 1;
    await store.incrementFloat(aiCostKey('2026-10-17'), 5, 60);

    await expect(service.isExceeded()).resolves.toBe(false);
  });

  it('should fail closed when the cost cannot be read', async () => {
    budget = 1;
    vi.spyOn(store, 'getNumber').mockRejectedValue(new Error('down'));

    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });

  it('should accumulate the estimated cost and upsert the daily usage', async () => {
    const cost = await service.record({
      kind: 'chat',
      model: 'deepseek-chat',
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 0,
      failed: true,
      countsAsRequest: true,
    });

    expect(cost).toBe(2);
    await expect(store.getNumber(aiCostKey('2026-10-18'))).resolves.toBe(2);
    expect(usageRepository.increment).toHaveBeenCalledWith({
      date: '2026-10-18',
      model: 'deepseek-chat',
      kind: 'chat',
      requests: 1,
      failures: 1,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cost: 2,
    });
  });

  it('should accumulate tokens and cost without counting a request when it is not a user request', async () => {
    await service.record({
      kind: 'chat',
      model: 'deepseek-chat',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      failed: true,
      countsAsRequest: false,
    });

    await expect(store.getNumber(aiCostKey('2026-10-18'))).resolves.toBe(8);
    expect(usageRepository.increment).toHaveBeenCalledWith(
      expect.objectContaining({ requests: 0, failures: 0, outputTokens: 1_000_000, cost: 8 }),
    );
  });

  it('should raise a critical alert once a day when the breaker trips', async () => {
    budget = 1;
    await store.incrementFloat(aiCostKey('2026-10-18'), 1, 60);

    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });

    expect(alertReporter.raise).toHaveBeenCalledTimes(1);
    expect(alertReporter.raise).toHaveBeenCalledWith(
      AI_BUDGET_ALERT_TYPE,
      AlertLevel.CRITICAL,
      expect.any(String),
      { date: '2026-10-18', cost: 1, budget: 1 },
      `${AI_BUDGET_ALERT_TYPE}:2026-10-18`,
    );

    vi.setSystemTime(new Date('2026-10-19T02:00:00Z'));
    await store.incrementFloat(aiCostKey('2026-10-19'), 1, 60);
    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    expect(alertReporter.raise).toHaveBeenCalledTimes(2);
  });

  it('should raise the alert when a recorded cost reaches the budget', async () => {
    budget = 2;
    const usage = {
      kind: 'chat' as const,
      model: 'deepseek-chat',
      inputTokens: 500_000,
      cachedInputTokens: 0,
      outputTokens: 0,
      failed: false,
      countsAsRequest: true,
    };

    await service.record(usage);
    expect(alertReporter.raise).not.toHaveBeenCalled();

    await service.record(usage);
    await service.record(usage);
    expect(alertReporter.raise).toHaveBeenCalledTimes(1);
    expect(alertReporter.raise).toHaveBeenCalledWith(
      AI_BUDGET_ALERT_TYPE,
      AlertLevel.CRITICAL,
      expect.any(String),
      expect.objectContaining({ date: '2026-10-18', budget: 2 }),
      `${AI_BUDGET_ALERT_TYPE}:2026-10-18`,
    );
  });

  it('should still reject when the alert cannot be raised', async () => {
    budget = 1;
    await store.incrementFloat(aiCostKey('2026-10-18'), 1, 60);
    alertReporter.raise.mockRejectedValue(new Error('db down'));

    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });

  it('should clear the daily alert mark when the alert cannot be raised so that it is retried', async () => {
    budget = 1;
    await store.incrementFloat(aiCostKey('2026-10-18'), 1, 60);
    alertReporter.raise.mockRejectedValueOnce(new Error('db down'));

    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    await expect(store.getNumber(aiBudgetAlertKey('2026-10-18'))).resolves.toBe(0);
    await expect(service.assertWithinBudget()).rejects.toMatchObject({ errorKey: 'aiUnavailable' });

    expect(alertReporter.raise).toHaveBeenCalledTimes(2);
    await expect(store.getNumber(aiBudgetAlertKey('2026-10-18'))).resolves.toBe(1);
  });
});
