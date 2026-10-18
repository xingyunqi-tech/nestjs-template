import { Injectable } from '@nestjs/common';
import { TransactionHandle } from '../../../common/database/transaction-handle';
import { StatsRecord } from '../domain/stats-record';

/** 统计事件处理器事务内的知识点与每日统计更新 */
export abstract class LearningStatsUpdater {
  abstract apply(handle: TransactionHandle, record: StatsRecord): Promise<void>;
}

@Injectable()
export class NoopLearningStatsUpdater implements LearningStatsUpdater {
  apply(_handle: TransactionHandle, _record: StatsRecord): Promise<void> {
    return Promise.resolve();
  }
}
