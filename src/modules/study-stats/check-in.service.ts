import { Injectable } from '@nestjs/common';
import { CheckInRepository, CheckinStreak } from './infrastructure/persistence/check-in.repository';
import { CheckInEvaluator } from './ports/check-in.evaluator';
import { StatsRecord } from './domain/stats-record';
import { CheckinReason, StudyCheckin } from './domain/study-checkin';
import { statDateOf } from './domain/stat-date';
import { monthRange } from './domain/calendar';
import { businessDate } from '../papers/domain/business-date';
import { TransactionHandle } from '../../common/database/transaction-handle';

@Injectable()
export class CheckInService implements CheckInEvaluator {
  constructor(private readonly repository: CheckInRepository) {}

  /** 打卡日期取记录统计日 */
  apply(handle: TransactionHandle, record: StatsRecord): Promise<void> {
    return this.evaluate(handle, record.userId, statDateOf(record));
  }

  /** 该日每日一练完成，或该日当前考试下作答数达到每日目标 */
  async evaluate(handle: TransactionHandle, userId: number, date: string): Promise<void> {
    await this.repository.lockUserDate(handle, userId, date);
    if (await this.repository.hasCheckin(handle, userId, date)) {
      return;
    }
    if (await this.repository.isDailySessionDone(handle, userId, date)) {
      await this.repository.insert(handle, userId, date, CheckinReason.DAILY_DONE);
      return;
    }
    const goal = await this.repository.findGoalProgress(handle, userId, date);
    if (goal && goal.dailyGoal > 0 && goal.answered >= goal.dailyGoal) {
      await this.repository.insert(handle, userId, date, CheckinReason.GOAL_REACHED);
    }
  }

  findStreak(userId: number, today: string = businessDate()): Promise<CheckinStreak> {
    return this.repository.findStreak(userId, today);
  }

  findMonth(userId: number, month: string): Promise<StudyCheckin[]> {
    const { from, to } = monthRange(month);
    return this.repository.findByDateRange(userId, from, to);
  }
}
