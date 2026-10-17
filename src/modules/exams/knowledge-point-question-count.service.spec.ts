import type { Mocked } from 'vitest';
import type { EntityManager } from 'typeorm';
import { KnowledgePointQuestionCountService } from './knowledge-point-question-count.service';
import { KnowledgePointRepository } from './infrastructure/persistence/knowledge-point.repository';
import { KnowledgePointQuestionRepository } from './infrastructure/persistence/knowledge-point-question.repository';

describe('KnowledgePointQuestionCountService', () => {
  let repository: Mocked<Pick<KnowledgePointRepository, 'adjustQuestionCounts'>>;
  let links: Mocked<
    Pick<KnowledgePointQuestionRepository, 'recountQuestionCounts' | 'lockSubject' | 'lockKnowledgePoints'>
  >;
  let service: KnowledgePointQuestionCountService;

  beforeEach(() => {
    repository = { adjustQuestionCounts: vi.fn() };
    links = { recountQuestionCounts: vi.fn(), lockSubject: vi.fn(), lockKnowledgePoints: vi.fn() };
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

    expect(repository.adjustQuestionCounts).toHaveBeenCalledWith([{ knowledgePointId: 'k1', delta: -1 }], undefined);
  });

  it('should adjust counts within the caller transaction', async () => {
    const manager = {} as EntityManager;

    await service.adjust([{ knowledgePointId: 'k1', delta: 1 }], manager);

    expect(repository.adjustQuestionCounts).toHaveBeenCalledWith([{ knowledgePointId: 'k1', delta: 1 }], manager);
  });

  it('should lock the subject and knowledge points within the caller transaction', async () => {
    const manager = {} as EntityManager;
    links.lockKnowledgePoints.mockResolvedValue([]);

    await service.lockSubject('s1', manager);
    await service.lockKnowledgePoints(['k1'], manager);

    expect(links.lockSubject).toHaveBeenCalledWith('s1', manager);
    expect(links.lockKnowledgePoints).toHaveBeenCalledWith(['k1'], manager);
  });
});
