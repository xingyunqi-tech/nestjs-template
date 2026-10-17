import { NullableType } from '../../../../common/types/nullable.type';
import { DailyQuestionSet } from '../../domain/daily-question-set';

type SubjectId = DailyQuestionSet['subjectId'];
type SetDate = DailyQuestionSet['date'];

export abstract class DailyQuestionSetRepository {
  abstract findOne(subjectId: SubjectId, date: SetDate): Promise<NullableType<DailyQuestionSet>>;

  /** 已存在时保留原题组并返回 */
  abstract insertIfAbsent(subjectId: SubjectId, date: SetDate, questionIds: string[]): Promise<DailyQuestionSet>;

  abstract upsert(subjectId: SubjectId, date: SetDate, questionIds: string[]): Promise<DailyQuestionSet>;

  /** 闭区间，按日期升序 */
  abstract findRange(subjectId: SubjectId, from: SetDate, to: SetDate): Promise<DailyQuestionSet[]>;
}
