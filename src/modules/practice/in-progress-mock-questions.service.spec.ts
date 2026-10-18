import type { Mocked } from 'vitest';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';

describe('InProgressMockQuestionsService', () => {
  it('should read the questions of ongoing mock exams from the database on every call', async () => {
    const repository: Mocked<Pick<PracticeSessionRepository, 'findInProgressMockQuestionIds'>> = {
      findInProgressMockQuestionIds: vi.fn().mockResolvedValueOnce(['q1', 'q2']).mockResolvedValueOnce([]),
    };
    const service = new InProgressMockQuestionsService(repository as unknown as PracticeSessionRepository);

    expect(await service.findQuestionIds(3)).toEqual(new Set(['q1', 'q2']));
    expect(await service.findQuestionIds(3)).toEqual(new Set());
    expect(repository.findInProgressMockQuestionIds).toHaveBeenCalledWith(3);
  });
});
