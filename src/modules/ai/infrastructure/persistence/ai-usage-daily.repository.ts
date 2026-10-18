import { AiUsageIncrement } from '../../domain/ai-usage-daily';

export abstract class AiUsageDailyRepository {
  /** 按 (date, model, kind) upsert 并累加 */
  abstract increment(data: AiUsageIncrement): Promise<void>;
}
