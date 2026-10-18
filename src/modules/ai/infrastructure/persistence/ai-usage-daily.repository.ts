import { AiUsageDaily, AiUsageIncrement } from '../../domain/ai-usage-daily';

export abstract class AiUsageDailyRepository {
  /** 按 (date, model, kind) upsert 并累加 */
  abstract increment(data: AiUsageIncrement): Promise<void>;

  /** from、to 均含，按日期、模型、类型升序 */
  abstract findRange(from: string, to: string): Promise<AiUsageDaily[]>;
}
