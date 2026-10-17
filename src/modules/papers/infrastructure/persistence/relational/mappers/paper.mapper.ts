import { Paper } from '../../../../domain/paper';
import { PaperEntity } from '../entities/paper.entity';
import { CreatePaperData } from '../../paper.repository';

export class PaperMapper {
  static toDomain(raw: PaperEntity, questionCount: number): Paper {
    const domain = new Paper();
    domain.id = raw.id;
    domain.subjectId = raw.subjectId;
    domain.title = raw.title;
    domain.type = raw.type;
    domain.year = raw.year;
    domain.ownerUserId = raw.ownerUserId;
    domain.durationMin = raw.durationMin;
    domain.sections = raw.sections.map(({ title, questionType }) => ({ title, questionType }));
    domain.totalScore = Number(raw.totalScore);
    domain.objectiveScore = Number(raw.objectiveScore);
    domain.multiScoringRule = raw.multiScoringRule;
    domain.status = raw.status;
    domain.isFree = raw.isFree;
    domain.attemptCount = raw.attemptCount;
    domain.questionCount = questionCount;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: CreatePaperData): PaperEntity {
    const entity = new PaperEntity();
    entity.subjectId = domain.subjectId;
    entity.title = domain.title;
    entity.type = domain.type;
    entity.year = domain.year;
    entity.ownerUserId = domain.ownerUserId;
    entity.durationMin = domain.durationMin;
    entity.sections = domain.sections;
    entity.totalScore = domain.totalScore.toFixed(2);
    entity.objectiveScore = domain.objectiveScore.toFixed(2);
    entity.multiScoringRule = domain.multiScoringRule;
    entity.status = domain.status;
    entity.isFree = domain.isFree;
    return entity;
  }
}
