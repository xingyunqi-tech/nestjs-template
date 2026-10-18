import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import aiConfig from './config/ai.config';
import { AiRealtimeStore, aiCostKey } from './infrastructure/realtime/ai-realtime.store';
import { AiUsageDailyRepository } from './infrastructure/persistence/ai-usage-daily.repository';
import { AiTokenUsage, estimateCost } from './domain/ai-cost';
import { AiUsageKind } from './domain/ai-usage-daily';
import { AppConfigService } from '../config/config.service';
import { businessDate } from '../papers/domain/business-date';
import { BusinessException } from '../../common/exceptions/business.exception';

const COST_TTL_SECONDS = 48 * 60 * 60;

export interface AiUsageRecord extends AiTokenUsage {
  kind: AiUsageKind;
  model: string;
  failed: boolean;
  /** 为 false 时只累计 token 与成本，不计请求数与失败数 */
  countsAsRequest: boolean;
}

/** 全站成本：按日累计估算成本并落库，超过 ai.dailyBudget 时熔断；未配置预算时不熔断 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);

  constructor(
    private readonly store: AiRealtimeStore,
    private readonly usageDailyRepository: AiUsageDailyRepository,
    private readonly appConfigService: AppConfigService,
    @Inject(aiConfig.KEY) private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  /** @throws BusinessException aiUnavailable 当日估算成本已达预算，或成本计数不可读 */
  async assertWithinBudget(): Promise<void> {
    let exceeded: boolean;
    try {
      exceeded = await this.isExceeded();
    } catch (error) {
      this.logger.error(`AI cost store unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw new BusinessException('aiUnavailable');
    }
    if (exceeded) {
      throw new BusinessException('aiUnavailable');
    }
  }

  async isExceeded(date: string = businessDate()): Promise<boolean> {
    const budget = await this.appConfigService.getValue<unknown>('ai.dailyBudget');
    if (typeof budget !== 'number' || !Number.isFinite(budget)) {
      return false;
    }
    return (await this.store.getNumber(aiCostKey(date))) >= budget;
  }

  /** 累计成本与当日用量，返回本次估算成本 */
  async record(usage: AiUsageRecord): Promise<number> {
    const cost = estimateCost(usage, {
      inputCacheHit: this.config.priceInputCacheHit,
      inputCacheMiss: this.config.priceInputCacheMiss,
      output: this.config.priceOutput,
    });
    const date = businessDate();
    await Promise.all([
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
    return cost;
  }
}
