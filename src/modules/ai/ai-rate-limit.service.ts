import { Injectable, Logger } from '@nestjs/common';
import { AiRealtimeStore, aiRateKey } from './infrastructure/realtime/ai-realtime.store';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const WINDOW_MS = 60_000;

const KEY_TTL_SECONDS = 120;

export const DEFAULT_AI_RATE_PER_MINUTE = 10;

/** 每用户每分钟 AI 请求上限（ai.ratePerMinute），按自然分钟计数 */
@Injectable()
export class AiRateLimitService {
  private readonly logger = new Logger(AiRateLimitService.name);

  constructor(
    private readonly store: AiRealtimeStore,
    private readonly appConfigService: AppConfigService,
  ) {}

  /** @throws BusinessException aiRateLimited；计数存储不可用时 aiUnavailable */
  async assertWithinRate(userId: number, now: Date = new Date()): Promise<void> {
    const limit = await this.limit();
    const minute = Math.floor(now.getTime() / WINDOW_MS);
    let count: number;
    try {
      count = await this.store.increment(aiRateKey(userId, minute), KEY_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`AI rate store unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw new BusinessException('aiUnavailable');
    }
    if (count > limit) {
      const retryAfter = Math.ceil(((minute + 1) * WINDOW_MS - now.getTime()) / 1000);
      throw new BusinessException('aiRateLimited', { limit, retryAfter });
    }
  }

  private async limit(): Promise<number> {
    const value = await this.appConfigService.getValue<unknown>('ai.ratePerMinute');
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_AI_RATE_PER_MINUTE;
  }
}
