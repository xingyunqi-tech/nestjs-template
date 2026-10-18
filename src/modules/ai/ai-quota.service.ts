import { Injectable, Logger } from '@nestjs/common';
import { AiRealtimeStore, aiQuotaKey } from './infrastructure/realtime/ai-realtime.store';
import { AiUsageKind } from './domain/ai-usage-daily';
import { AppConfigService } from '../config/config.service';
import { ConfigKey } from '../config/config-definitions';
import { businessDate } from '../papers/domain/business-date';
import { BusinessException } from '../../common/exceptions/business.exception';

const QUOTA_TTL_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

const QUOTA_TTL_SECONDS = (QUOTA_TTL_DAYS * DAY_MS) / 1000;

const LIMIT_KEYS: Record<AiUsageKind, ConfigKey> = {
  chat: 'ai.quota.chat',
  grading: 'ai.quota.grading',
};

export interface AiQuotaStatus {
  date: string;
  limit: number;
  used: number;
  remaining: number;
}

/** 用户每日 AI 额度：INCR 后比较上限，超限回滚；退还按扣减时的日期 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger(AiQuotaService.name);

  constructor(
    private readonly store: AiRealtimeStore,
    private readonly appConfigService: AppConfigService,
  ) {}

  /**
   * 扣减当日额度，返回额度所属日期
   * @throws BusinessException aiQuotaExceeded；计数存储不可用时 aiUnavailable
   */
  async consume(userId: number, kind: AiUsageKind): Promise<string> {
    const date = businessDate();
    const key = aiQuotaKey(userId, date, kind);
    const limit = await this.limitOf(kind);
    const used = await this.guard(() => this.store.increment(key, QUOTA_TTL_SECONDS));
    if (used > limit) {
      await this.guard(() => this.store.decrement(key));
      throw new BusinessException('aiQuotaExceeded', { limit });
    }
    return date;
  }

  /** 退还 quotaDate 当日的一次额度 */
  async refund(userId: number, kind: AiUsageKind, quotaDate: string): Promise<void> {
    await this.store.decrement(aiQuotaKey(userId, quotaDate, kind));
  }

  /** 删除该用户仍可能存在的额度计数 */
  async clear(userId: number, now: Date = new Date()): Promise<void> {
    const dates = Array.from({ length: QUOTA_TTL_DAYS + 1 }, (_, days) =>
      businessDate(new Date(now.getTime() - days * DAY_MS)),
    );
    const kinds = Object.keys(LIMIT_KEYS) as AiUsageKind[];
    await this.store.remove(dates.flatMap((date) => kinds.map((kind) => aiQuotaKey(userId, date, kind))));
  }

  /** @throws BusinessException 计数存储不可用时 aiUnavailable */
  async getStatus(userId: number, kind: AiUsageKind, date: string = businessDate()): Promise<AiQuotaStatus> {
    const [limit, used] = await Promise.all([
      this.limitOf(kind),
      this.guard(() => this.store.getNumber(aiQuotaKey(userId, date, kind))),
    ]);
    return { date, limit, used, remaining: Math.max(limit - used, 0) };
  }

  private async limitOf(kind: AiUsageKind): Promise<number> {
    const value = await this.appConfigService.getValue<unknown>(LIMIT_KEYS[kind]);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(`AI quota store unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw new BusinessException('aiUnavailable');
    }
  }
}
