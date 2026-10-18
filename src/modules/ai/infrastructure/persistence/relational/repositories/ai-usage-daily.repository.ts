import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AiUsageDailyEntity } from '../entities/ai-usage-daily.entity';
import { AiUsageDailyRepository } from '../../ai-usage-daily.repository';
import { AiUsageDailyMapper } from '../mappers/ai-usage-daily.mapper';
import { AiUsageDaily, AiUsageIncrement } from '../../../../domain/ai-usage-daily';

@Injectable()
export class AiUsageDailyRelationalRepository implements AiUsageDailyRepository {
  constructor(
    @InjectRepository(AiUsageDailyEntity)
    private readonly repository: Repository<AiUsageDailyEntity>,
  ) {}

  async increment(data: AiUsageIncrement): Promise<void> {
    await this.repository.query(
      `INSERT INTO "ai_usage_daily" ("date", "model", "kind", "requests", "failures", "inputTokens", "outputTokens", "cachedInputTokens", "cost")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ("date", "model", "kind") DO UPDATE SET
         "requests" = "ai_usage_daily"."requests" + EXCLUDED."requests",
         "failures" = "ai_usage_daily"."failures" + EXCLUDED."failures",
         "inputTokens" = "ai_usage_daily"."inputTokens" + EXCLUDED."inputTokens",
         "outputTokens" = "ai_usage_daily"."outputTokens" + EXCLUDED."outputTokens",
         "cachedInputTokens" = "ai_usage_daily"."cachedInputTokens" + EXCLUDED."cachedInputTokens",
         "cost" = "ai_usage_daily"."cost" + EXCLUDED."cost",
         "updatedAt" = now()`,
      [
        data.date,
        data.model,
        data.kind,
        data.requests,
        data.failures,
        data.inputTokens,
        data.outputTokens,
        data.cachedInputTokens,
        data.cost,
      ],
    );
  }

  async findRange(from: string, to: string): Promise<AiUsageDaily[]> {
    const entities = await this.repository.find({
      where: { date: Between(from, to) },
      order: { date: 'ASC', model: 'ASC', kind: 'ASC' },
    });
    return entities.map((entity) => AiUsageDailyMapper.toDomain(entity));
  }
}
