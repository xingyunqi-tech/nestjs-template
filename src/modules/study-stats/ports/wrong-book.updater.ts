import { TransactionHandle } from '../../../common/database/transaction-handle';
import { StatsRecord } from '../domain/stats-record';

/** 统计事件处理器事务内的错题本更新 */
export abstract class WrongBookUpdater {
  abstract apply(handle: TransactionHandle, record: StatsRecord): Promise<void>;
}
