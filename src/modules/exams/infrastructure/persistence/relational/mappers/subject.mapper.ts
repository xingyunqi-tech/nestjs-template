import { Subject } from '../../../../domain/subject';
import { SubjectEntity } from '../entities/subject.entity';

export class SubjectMapper {
  static toDomain(raw: SubjectEntity): Subject {
    const domain = new Subject();
    domain.id = raw.id;
    domain.examId = raw.examId;
    domain.name = raw.name;
    domain.sort = raw.sort;
    domain.status = raw.status;
    domain.hasSubjective = raw.hasSubjective;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: Omit<Subject, 'id' | 'createdAt' | 'updatedAt'>): SubjectEntity {
    const entity = new SubjectEntity();
    entity.examId = domain.examId;
    entity.name = domain.name;
    entity.sort = domain.sort;
    entity.status = domain.status;
    entity.hasSubjective = domain.hasSubjective;
    return entity;
  }
}
