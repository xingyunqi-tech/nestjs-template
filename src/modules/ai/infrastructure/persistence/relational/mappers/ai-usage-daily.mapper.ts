import { AiUsageDaily } from '../../../../domain/ai-usage-daily';
import { AiUsageDailyEntity } from '../entities/ai-usage-daily.entity';

export class AiUsageDailyMapper {
  static toDomain(raw: AiUsageDailyEntity): AiUsageDaily {
    const domain = new AiUsageDaily();
    domain.id = raw.id;
    domain.date = raw.date;
    domain.model = raw.model;
    domain.kind = raw.kind;
    domain.requests = raw.requests;
    domain.failures = raw.failures;
    domain.inputTokens = Number(raw.inputTokens);
    domain.outputTokens = Number(raw.outputTokens);
    domain.cost = Number(raw.cost);
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}
