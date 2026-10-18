import { TransactionHandle } from '../../../common/database/transaction-handle';
import { StatsRecord } from '../domain/stats-record';

/** 统计事件处理器事务内的知识点与每日统计更新 */
export abstract class LearningStatsUpdater {
  abstract apply(handle: TransactionHandle, record: StatsRecord): Promise<void>;

  /** 记录计入的事务提交后执行 */
  abstract afterCommit(record: StatsRecord): Promise<void>;
}
