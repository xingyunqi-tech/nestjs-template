import { Exam } from '../../../../domain/exam';
import { ExamEntity } from '../entities/exam.entity';

export class ExamMapper {
  static toDomain(raw: ExamEntity): Exam {
    const domain = new Exam();
    domain.id = raw.id;
    domain.name = raw.name;
    domain.category = raw.category;
    domain.icon = raw.icon;
    domain.description = raw.description;
    domain.sort = raw.sort;
    domain.status = raw.status;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: Omit<Exam, 'id' | 'createdAt' | 'updatedAt'>): ExamEntity {
    const entity = new ExamEntity();
    entity.name = domain.name;
    entity.category = domain.category;
    entity.icon = domain.icon ?? null;
    entity.description = domain.description ?? null;
    entity.sort = domain.sort;
    entity.status = domain.status;
    return entity;
  }
}
