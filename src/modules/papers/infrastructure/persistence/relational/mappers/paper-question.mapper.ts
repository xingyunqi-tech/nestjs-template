import { PaperQuestion } from '../../../../domain/paper-question';
import { PaperQuestionEntity } from '../entities/paper-question.entity';

export class PaperQuestionMapper {
  static toDomain(raw: PaperQuestionEntity): PaperQuestion {
    const domain = new PaperQuestion();
    domain.paperId = raw.paperId;
    domain.sectionIndex = raw.sectionIndex;
    domain.questionId = raw.questionId;
    domain.questionVersion = raw.questionVersion;
    domain.sort = raw.sort;
    domain.score = Number(raw.score);
    return domain;
  }

  static toPersistence(domain: PaperQuestion): PaperQuestionEntity {
    const entity = new PaperQuestionEntity();
    entity.paperId = domain.paperId;
    entity.sectionIndex = domain.sectionIndex;
    entity.questionId = domain.questionId;
    entity.questionVersion = domain.questionVersion;
    entity.sort = domain.sort;
    entity.score = domain.score.toFixed(2);
    return entity;
  }
}
