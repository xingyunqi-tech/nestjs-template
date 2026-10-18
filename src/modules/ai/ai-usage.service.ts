import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AiQuotaService } from './ai-quota.service';
import { AiUsageDailyRepository } from './infrastructure/persistence/ai-usage-daily.repository';
import { AiQuotaDto } from './dto/ai-quota.dto';
import { AiUsageDto, AiUsageItemDto, AiUsageTotalDto } from './dto/ai-usage.dto';
import { daysBetween } from '../papers/domain/business-date';

const MAX_RANGE_DAYS = 366;

const COST_SCALE = 1_000_000;

@Injectable()
export class AiUsageService {
  constructor(
    private readonly quotaService: AiQuotaService,
    private readonly usageDailyRepository: AiUsageDailyRepository,
  ) {}

  async getQuota(userId: number): Promise<AiQuotaDto> {
    const { date, limit, used, remaining } = await this.quotaService.getStatus(userId, 'chat');
    return { date, chat: { limit, used, remaining } };
  }

  /** @throws UnprocessableEntityException invalidDateRange */
  async findUsage(from: string, to: string): Promise<AiUsageDto> {
    const days = daysBetween(from, to);
    if (!Number.isFinite(days) || days < 0 || days >= MAX_RANGE_DAYS) {
      throw new UnprocessableEntityException({ errors: { to: 'invalidDateRange' } });
    }
    const rows = await this.usageDailyRepository.findRange(from, to);
    const items = rows.map((row): AiUsageItemDto => ({
      date: row.date,
      model: row.model,
      kind: row.kind,
      requests: row.requests,
      failures: row.failures,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      cost: row.cost,
    }));
    const total = items.reduce<AiUsageTotalDto>(
      (sum, item) => ({
        requests: sum.requests + item.requests,
        failures: sum.failures + item.failures,
        inputTokens: sum.inputTokens + item.inputTokens,
        outputTokens: sum.outputTokens + item.outputTokens,
        cachedInputTokens: sum.cachedInputTokens + item.cachedInputTokens,
        cost: sum.cost + item.cost,
      }),
      { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cost: 0 },
    );
    total.cost = Math.round(total.cost * COST_SCALE) / COST_SCALE;
    return { items, total };
  }
}
