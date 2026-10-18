import { DailyQuestionSet } from '../../domain/daily-question-set';

export interface DailySessionProgress {
  sessionId: string;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
}

/** 每日一练题组被用户会话使用的情况 */
export abstract class DailySetUsageRepository {
  abstract hasSessions(subjectId: DailyQuestionSet['subjectId'], date: DailyQuestionSet['date']): Promise<boolean>;

  /** 持有科目与日期的锁执行 work，与创建每日一练会话互斥 */
  abstract runLocked<T>(
    subjectId: DailyQuestionSet['subjectId'],
    date: DailyQuestionSet['date'],
    work: () => Promise<T>,
  ): Promise<T>;

  abstract findSessionProgress(
    userId: number,
    subjectId: DailyQuestionSet['subjectId'],
    date: DailyQuestionSet['date'],
  ): Promise<DailySessionProgress | null>;

  /** questionIds 中位于该用户进行中模考的题目 */
  abstract findInProgressMockQuestionIds(userId: number, questionIds: string[]): Promise<string[]>;
}
