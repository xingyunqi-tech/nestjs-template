import { QuestionVersion } from '../../../../domain/question-version';
import { QuestionVersionEntity } from '../entities/question-version.entity';
import { CreateQuestionVersionData } from '../../question.repository';

export class QuestionVersionMapper {
  static toDomain(raw: QuestionVersionEntity): QuestionVersion {
    const domain = new QuestionVersion();
    domain.id = raw.id;
    domain.questionId = raw.questionId;
    domain.version = raw.version;
    domain.type = raw.type;
    domain.stem = raw.stem;
    domain.options = raw.options;
    domain.answer = raw.answer;
    domain.analysis = raw.analysis;
    domain.material = raw.material;
    domain.audioFileId = raw.audioFileId;
    domain.knowledgePointIds = raw.knowledgePointIds;
    domain.materialVersion = raw.materialVersion;
    domain.changeType = raw.changeType;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: CreateQuestionVersionData): QuestionVersionEntity {
    const entity = new QuestionVersionEntity();
    entity.questionId = domain.questionId;
    entity.version = domain.version;
    entity.type = domain.type;
    entity.stem = domain.stem;
    entity.options = domain.options;
    entity.answer = domain.answer;
    entity.analysis = domain.analysis;
    entity.material = domain.material;
    entity.audioFileId = domain.audioFileId;
    entity.knowledgePointIds = domain.knowledgePointIds;
    entity.materialVersion = domain.materialVersion;
    entity.changeType = domain.changeType;
    return entity;
  }
}
