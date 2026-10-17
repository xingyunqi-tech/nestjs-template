import { DailyQuestionSet } from '../../../../domain/daily-question-set';
import { DailyQuestionSetEntity } from '../entities/daily-question-set.entity';

export class DailyQuestionSetMapper {
  static toDomain(raw: DailyQuestionSetEntity): DailyQuestionSet {
    const domain = new DailyQuestionSet();
    domain.id = raw.id;
    domain.subjectId = raw.subjectId;
    domain.date = raw.date;
    domain.questionIds = [...raw.questionIds];
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}
