import { Injectable } from '@nestjs/common';
import { KnowledgePointRepository, QuestionCountDelta } from './infrastructure/persistence/knowledge-point.repository';
import { KnowledgePointQuestionRepository } from './infrastructure/persistence/knowledge-point-question.repository';
import { Subject } from './domain/subject';

@Injectable()
export class KnowledgePointQuestionCountService {
  constructor(
    private readonly knowledgePointRepository: KnowledgePointRepository,
    private readonly knowledgePointQuestionRepository: KnowledgePointQuestionRepository,
  ) {}

  adjust(deltas: QuestionCountDelta[]): Promise<void> {
    return this.knowledgePointRepository.adjustQuestionCounts(deltas);
  }

  recount(subjectId?: Subject['id']): Promise<number> {
    return this.knowledgePointQuestionRepository.recountQuestionCounts(subjectId);
  }
}
