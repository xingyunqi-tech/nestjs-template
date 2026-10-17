import { DailyQuestionSet } from '../../domain/daily-question-set';

/** 每日一练题组被用户会话使用的情况 */
export abstract class DailySetUsageRepository {
  abstract hasSessions(subjectId: DailyQuestionSet['subjectId'], date: DailyQuestionSet['date']): Promise<boolean>;
}
