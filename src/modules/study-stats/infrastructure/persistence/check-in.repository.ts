import { NullableType } from '../../../../common/types/nullable.type';
import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { CheckinReason, StudyCheckin } from '../../domain/study-checkin';

export interface GoalProgress {
  dailyGoal: number;
  answered: number;
}

export interface CheckinStreak {
  streakDays: number;
  checkedInToday: boolean;
}

export abstract class CheckInRepository {
  /** 事务内按 (userId, date) 串行化打卡判定 */
  abstract lockUserDate(handle: TransactionHandle, userId: number, date: string): Promise<void>;

  abstract hasCheckin(handle: TransactionHandle, userId: number, date: string): Promise<boolean>;

  /** 该日存在每日一练会话：客观题均在该日判分计入，主观题均在该日作答或自评 */
  abstract isDailySessionDone(handle: TransactionHandle, userId: number, date: string): Promise<boolean>;

  /** 当前考试的每日目标与该日该考试下各科目作答数之和；没有当前考试时为 null */
  abstract findGoalProgress(
    handle: TransactionHandle,
    userId: number,
    date: string,
  ): Promise<NullableType<GoalProgress>>;

  /** 返回是否新写入 */
  abstract insert(handle: TransactionHandle, userId: number, date: string, reason: CheckinReason): Promise<boolean>;

  abstract findByDateRange(userId: number, from: string, to: string): Promise<StudyCheckin[]>;

  /** 从 today（未打卡则从前一天）向前连续打卡的天数 */
  abstract findStreak(userId: number, today: string): Promise<CheckinStreak>;
}
