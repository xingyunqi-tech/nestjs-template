import type { Mocked } from 'vitest';
import { KnowledgePointQuestionCountService } from './knowledge-point-question-count.service';
import { KnowledgePointRepository } from './infrastructure/persistence/knowledge-point.repository';
import { KnowledgePointQuestionRepository } from './infrastructure/persistence/knowledge-point-question.repository';

describe('KnowledgePointQuestionCountService', () => {
  let repository: Mocked<Pick<KnowledgePointRepository, 'adjustQuestionCounts'>>;
  let links: Mocked<Pick<KnowledgePointQuestionRepository, 'recountQuestionCounts'>>;
  let service: KnowledgePointQuestionCountService;

  beforeEach(() => {
    repository = { adjustQuestionCounts: vi.fn() };
    links = { recountQuestionCounts: vi.fn() };
    service = new KnowledgePointQuestionCountService(
      repository as unknown as KnowledgePointRepository,
      links as unknown as KnowledgePointQuestionRepository,
    );
  });

  it('should recount within the given subject', async () => {
    links.recountQuestionCounts.mockResolvedValue(2);

    await expect(service.recount('s1')).resolves.toBe(2);
    expect(links.recountQuestionCounts).toHaveBeenCalledWith('s1');
  });

  it('should forward count deltas to the repository', async () => {
    await service.adjust([{ knowledgePointId: 'k1', delta: -1 }]);

    expect(repository.adjustQuestionCounts).toHaveBeenCalledWith([{ knowledgePointId: 'k1', delta: -1 }]);
  });
});
