import { PaperRule } from '../../../../domain/paper-rule';
import { PaperRuleEntity } from '../entities/paper-rule.entity';
import { CreatePaperRuleData } from '../../paper-rule.repository';

export class PaperRuleMapper {
  static toDomain(raw: PaperRuleEntity): PaperRule {
    const domain = new PaperRule();
    domain.id = raw.id;
    domain.subjectId = raw.subjectId;
    domain.name = raw.name;
    domain.durationMin = raw.durationMin;
    domain.multiScoringRule = raw.multiScoringRule;
    domain.items = raw.items;
    domain.status = raw.status;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: CreatePaperRuleData): PaperRuleEntity {
    const entity = new PaperRuleEntity();
    entity.subjectId = domain.subjectId;
    entity.name = domain.name;
    entity.durationMin = domain.durationMin;
    entity.multiScoringRule = domain.multiScoringRule;
    entity.items = domain.items;
    entity.status = domain.status;
    return entity;
  }
}
