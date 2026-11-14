import { DailyQuestionSet } from '../../domain/daily-question-set';

export interface DailySessionProgress {
  sessionId: string;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
}

/** 每日一练题组被用户会话使用的情况 */
export abstract class DailySetUsageRepository {
  /** 持有科目与日期的锁：尚无用户会话时以 questionIds 覆盖题组并返回，已有会话时返回 null */
  abstract replaceIfUnused(
    subjectId: DailyQuestionSet['subjectId'],
    date: DailyQuestionSet['date'],
    questionIds: string[],
  ): Promise<DailyQuestionSet | null>;

  abstract findSessionProgress(
    userId: number,
    subjectId: DailyQuestionSet['subjectId'],
    date: DailyQuestionSet['date'],
  ): Promise<DailySessionProgress | null>;

  /** questionIds 中位于该用户进行中模考的题目 */
  abstract findInProgressMockQuestionIds(userId: number, questionIds: string[]): Promise<string[]>;
}
