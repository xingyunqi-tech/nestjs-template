import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import aiConfig from './config/ai.config';
import { AiRealtimeStore, aiBudgetAlertKey, aiCostKey } from './infrastructure/realtime/ai-realtime.store';
import { AiUsageDailyRepository } from './infrastructure/persistence/ai-usage-daily.repository';
import { AiTokenUsage, estimateCost } from './domain/ai-cost';
import { AiUsageKind } from './domain/ai-usage-daily';
import { AppConfigService } from '../config/config.service';
import { businessDate } from '../papers/domain/business-date';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';

const COST_TTL_SECONDS = 48 * 60 * 60;

export const AI_BUDGET_ALERT_TYPE = 'aiBudgetExceeded';

export interface AiUsageRecord extends AiTokenUsage {
  kind: AiUsageKind;
  model: string;
  failed: boolean;
  /** 为 false 时只累计 token 与成本，不计请求数与失败数 */
  countsAsRequest: boolean;
}

/** 全站成本：按日累计估算成本并落库，超过 ai.dailyBudget 时熔断并告警（每天一次）；未配置预算时不熔断 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);

  constructor(
    private readonly store: AiRealtimeStore,
    private readonly usageDailyRepository: AiUsageDailyRepository,
    private readonly appConfigService: AppConfigService,
    @Inject(aiConfig.KEY) private readonly config: ConfigType<typeof aiConfig>,
    @Optional() private readonly alertReporter?: AlertReporter,
  ) {}

  /** @throws BusinessException aiUnavailable 当日估算成本已达预算，或成本计数不可读 */
  async assertWithinBudget(): Promise<void> {
    const date = businessDate();
    let state: { budget: number | null; cost: number };
    try {
      state = await this.stateOf(date);
    } catch (error) {
      this.logger.error(`AI cost store unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw new BusinessException('aiUnavailable');
    }
    if (state.budget !== null && state.cost >= state.budget) {
      await this.alertExceeded(date, state.cost, state.budget);
      throw new BusinessException('aiUnavailable');
    }
  }

  async isExceeded(date: string = businessDate()): Promise<boolean> {
    const { budget, cost } = await this.stateOf(date);
    return budget !== null && cost >= budget;
  }

  /** 累计成本与当日用量，返回本次估算成本 */
  async record(usage: AiUsageRecord): Promise<number> {
    const cost = estimateCost(usage, {
      inputCacheHit: this.config.priceInputCacheHit,
      inputCacheMiss: this.config.priceInputCacheMiss,
      output: this.config.priceOutput,
    });
    const date = businessDate();
    const [total] = await Promise.all([
      cost > 0 ? this.store.incrementFloat(aiCostKey(date), cost, COST_TTL_SECONDS) : undefined,
      this.usageDailyRepository.increment({
        date,
        model: usage.model,
        kind: usage.kind,
        requests: usage.countsAsRequest ? 1 : 0,
        failures: usage.countsAsRequest && usage.failed ? 1 : 0,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost,
      }),
    ]);
    if (total !== undefined) {
      const budget = await this.budget().catch(() => null);
      if (budget !== null && total >= budget) {
        await this.alertExceeded(date, total, budget);
      }
    }
    return cost;
  }

  private async stateOf(date: string): Promise<{ budget: number | null; cost: number }> {
    const budget = await this.budget();
    return { budget, cost: budget === null ? 0 : await this.store.getNumber(aiCostKey(date)) };
  }

  private async budget(): Promise<number | null> {
    const value = await this.appConfigService.getValue<unknown>('ai.dailyBudget');
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** 同一天只告警一次；写入告警失败时清除标记以便后续重试，告警失败不影响调用方 */
  private async alertExceeded(date: string, cost: number, budget: number): Promise<void> {
    if (!this.alertReporter) {
      return;
    }
    const marker = aiBudgetAlertKey(date);
    try {
      if ((await this.store.increment(marker, COST_TTL_SECONDS)) !== 1) {
        return;
      }
    } catch (error) {
      this.logger.error(`Mark AI budget alert failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    try {
      await this.alertReporter.raise(
        AI_BUDGET_ALERT_TYPE,
        AlertLevel.CRITICAL,
        `${date} AI 估算成本 ${cost.toFixed(2)} 元已达每日预算 ${budget} 元，AI 服务已暂停`,
        { date, cost, budget },
        `${AI_BUDGET_ALERT_TYPE}:${date}`,
      );
    } catch (error) {
      this.logger.error(`Raise AI budget alert failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.store.remove([marker]).catch(() => undefined);
    }
  }
}
