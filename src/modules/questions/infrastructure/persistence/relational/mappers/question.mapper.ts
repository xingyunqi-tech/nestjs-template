import { Question } from '../../../../domain/question';
import { QuestionEntity } from '../entities/question.entity';
import { CreateQuestionData } from '../../question.repository';

export class QuestionMapper {
  static toDomain(raw: QuestionEntity, knowledgePointIds: string[]): Question {
    const domain = new Question();
    domain.id = raw.id;
    domain.subjectId = raw.subjectId;
    domain.parentId = raw.parentId;
    domain.type = raw.type;
    domain.currentVersion = raw.currentVersion;
    domain.stem = raw.stem;
    domain.options = raw.options;
    domain.answer = raw.answer;
    domain.analysis = raw.analysis;
    domain.difficulty = raw.difficulty;
    domain.knowledgePointIds = knowledgePointIds;
    domain.material = raw.material;
    domain.audioFileId = raw.audioFileId;
    domain.source = raw.source;
    domain.sourceNote = raw.sourceNote;
    domain.status = raw.status;
    domain.isFree = raw.isFree;
    domain.sort = raw.sort;
    domain.contentHash = raw.contentHash;
    domain.statAnswered = raw.statAnswered;
    domain.statCorrect = raw.statCorrect;
    domain.createdBy = raw.createdBy;
    domain.submittedBy = raw.submittedBy;
    domain.submittedAt = raw.submittedAt;
    domain.reviewedBy = raw.reviewedBy;
    domain.reviewedAt = raw.reviewedAt;
    domain.rejectReason = raw.rejectReason;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: CreateQuestionData): QuestionEntity {
    const entity = new QuestionEntity();
    entity.subjectId = domain.subjectId;
    entity.parentId = domain.parentId;
    entity.type = domain.type;
    entity.currentVersion = 0;
    entity.stem = domain.stem;
    entity.options = domain.options;
    entity.answer = domain.answer;
    entity.analysis = domain.analysis;
    entity.difficulty = domain.difficulty;
    entity.material = domain.material;
    entity.audioFileId = domain.audioFileId;
    entity.source = domain.source;
    entity.sourceNote = domain.sourceNote;
    entity.status = domain.status;
    entity.isFree = domain.isFree;
    entity.sort = domain.sort;
    entity.contentHash = domain.contentHash;
    entity.createdBy = domain.createdBy;
    return entity;
  }
}
