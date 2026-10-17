import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { KnowledgePointRepository, QuestionCountDelta } from './infrastructure/persistence/knowledge-point.repository';
import { KnowledgePointQuestionRepository } from './infrastructure/persistence/knowledge-point-question.repository';
import { KnowledgePoint } from './domain/knowledge-point';
import { Subject } from './domain/subject';

@Injectable()
export class KnowledgePointQuestionCountService {
  constructor(
    private readonly knowledgePointRepository: KnowledgePointRepository,
    private readonly knowledgePointQuestionRepository: KnowledgePointQuestionRepository,
  ) {}

  adjust(deltas: QuestionCountDelta[], manager?: EntityManager): Promise<void> {
    return this.knowledgePointRepository.adjustQuestionCounts(deltas, manager);
  }

  recount(subjectId?: Subject['id']): Promise<number> {
    return this.knowledgePointQuestionRepository.recountQuestionCounts(subjectId);
  }

  lockSubject(subjectId: Subject['id'], manager: EntityManager): Promise<void> {
    return this.knowledgePointQuestionRepository.lockSubject(subjectId, manager);
  }

  lockKnowledgePoints(ids: KnowledgePoint['id'][], manager: EntityManager): Promise<KnowledgePoint[]> {
    return this.knowledgePointQuestionRepository.lockKnowledgePoints(ids, manager);
  }
}
