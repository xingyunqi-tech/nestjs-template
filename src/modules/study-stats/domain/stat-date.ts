import { businessDate } from '../../papers/domain/business-date';
import { StatsRecord } from './stats-record';

/** 作答记录的统计日，缺失时取判分时间的 Asia/Shanghai 日期 */
export function statDateOf(record: Pick<StatsRecord, 'statDate' | 'gradedAt'>, now: Date = new Date()): string {
  return record.statDate ?? businessDate(record.gradedAt ?? now);
}
