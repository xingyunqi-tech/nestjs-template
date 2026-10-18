import { TransactionHandle } from '../../../common/database/transaction-handle';
import { StatsRecord } from '../domain/stats-record';

/** 统计事件处理器事务内的打卡判定 */
export abstract class CheckInEvaluator {
  abstract apply(handle: TransactionHandle, record: StatsRecord): Promise<void>;

  abstract evaluate(handle: TransactionHandle, userId: number, date: string): Promise<void>;
}
