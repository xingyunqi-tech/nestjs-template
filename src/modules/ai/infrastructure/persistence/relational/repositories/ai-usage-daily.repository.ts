import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsageDailyEntity } from '../entities/ai-usage-daily.entity';
import { AiUsageDailyRepository } from '../../ai-usage-daily.repository';
import { AiUsageIncrement } from '../../../../domain/ai-usage-daily';

@Injectable()
export class AiUsageDailyRelationalRepository implements AiUsageDailyRepository {
  constructor(
    @InjectRepository(AiUsageDailyEntity)
    private readonly repository: Repository<AiUsageDailyEntity>,
  ) {}

  async increment(data: AiUsageIncrement): Promise<void> {
    await this.repository.query(
      `INSERT INTO "ai_usage_daily" ("date", "model", "kind", "requests", "failures", "inputTokens", "outputTokens", "cost")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ("date", "model", "kind") DO UPDATE SET
         "requests" = "ai_usage_daily"."requests" + EXCLUDED."requests",
         "failures" = "ai_usage_daily"."failures" + EXCLUDED."failures",
         "inputTokens" = "ai_usage_daily"."inputTokens" + EXCLUDED."inputTokens",
         "outputTokens" = "ai_usage_daily"."outputTokens" + EXCLUDED."outputTokens",
         "cost" = "ai_usage_daily"."cost" + EXCLUDED."cost",
         "updatedAt" = now()`,
      [data.date, data.model, data.kind, data.requests, data.failures, data.inputTokens, data.outputTokens, data.cost],
    );
  }
}
