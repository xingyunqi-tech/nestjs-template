import { KnowledgePoint } from '../../../../domain/knowledge-point';
import { KnowledgePointEntity } from '../entities/knowledge-point.entity';

export class KnowledgePointMapper {
  static toDomain(raw: KnowledgePointEntity): KnowledgePoint {
    const domain = new KnowledgePoint();
    domain.id = raw.id;
    domain.subjectId = raw.subjectId;
    domain.parentId = raw.parentId;
    domain.name = raw.name;
    domain.level = raw.level;
    domain.sort = raw.sort;
    domain.path = raw.path;
    domain.isLeaf = raw.isLeaf;
    domain.questionCount = raw.questionCount;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: Omit<KnowledgePoint, 'createdAt' | 'updatedAt'>): KnowledgePointEntity {
    const entity = new KnowledgePointEntity();
    entity.id = domain.id;
    entity.subjectId = domain.subjectId;
    entity.parentId = domain.parentId;
    entity.name = domain.name;
    entity.level = domain.level;
    entity.sort = domain.sort;
    entity.path = domain.path;
    entity.isLeaf = domain.isLeaf;
    entity.questionCount = domain.questionCount;
    return entity;
  }
}
