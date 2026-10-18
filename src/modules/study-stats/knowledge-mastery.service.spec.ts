import type { Mocked } from 'vitest';
import type { Cache } from 'cache-manager';
import { KnowledgeMasteryService } from './knowledge-mastery.service';
import {
  LearningStatsRepository,
  SubtreeAnswerAggregate,
} from './infrastructure/persistence/learning-stats.repository';
import { UserKnowledgeStat } from './domain/user-knowledge-stat';

function memoryCache(): Cache {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve(value);
    }),
  } as unknown as Cache;
}

const answers = (overrides: Partial<SubtreeAnswerAggregate>): SubtreeAnswerAggregate => ({
  knowledgePointId: 'kp',
  answered: 0,
  correct: 0,
  recentAnswered: 0,
  recentCorrect: 0,
  answeredQuestionCount: 0,
  ...overrides,
});

const leafStat = (knowledgePointId: string, answered: number, results: number[]): UserKnowledgeStat =>
  Object.assign(new UserKnowledgeStat(), {
    knowledgePointId,
    answered,
    correct: results.filter((value) => value === 1).length,
    recentResults: results,
  });

describe('KnowledgeMasteryService', () => {
  let repository: Mocked<LearningStatsRepository>;
  let service: KnowledgeMasteryService;

  beforeEach(() => {
    repository = {
      applyKnowledgeResult: vi.fn(),
      addDailyStat: vi.fn(),
      claimMockSessionDuration: vi.fn(),
      findLeafStats: vi.fn().mockResolvedValue([]),
      aggregateSubtreeAnswers: vi.fn().mockResolvedValue([]),
      countSubtreeQuestions: vi.fn().mockResolvedValue([]),
      findDailyStats: vi.fn(),
      sumDailyStats: vi.fn(),
    };
    service = new KnowledgeMasteryService(repository, memoryCache());
  });

  it('should compute leaf and parent progress from the same subtree aggregates', async () => {
    repository.aggregateSubtreeAnswers.mockResolvedValue([
      answers({
        knowledgePointId: 'parent',
        answered: 10,
        correct: 5,
        recentAnswered: 10,
        recentCorrect: 5,
        answeredQuestionCount: 6,
      }),
      answers({
        knowledgePointId: 'leaf',
        answered: 6,
        correct: 3,
        recentAnswered: 6,
        recentCorrect: 3,
        answeredQuestionCount: 4,
      }),
    ]);
    repository.countSubtreeQuestions.mockResolvedValue([
      { knowledgePointId: 'parent', questionCount: 12 },
      { knowledgePointId: 'leaf', questionCount: 8 },
      { knowledgePointId: 'untouched', questionCount: 3 },
    ]);

    const progress = await service.findProgress(7, 'sub1');

    expect(repository.findLeafStats).not.toHaveBeenCalled();
    expect(progress.get('parent')).toEqual({
      answeredQuestionCount: 6,
      questionCount: 12,
      answered: 10,
      correct: 5,
      mastery: 50,
    });
    expect(progress.get('leaf')).toEqual({
      answeredQuestionCount: 4,
      questionCount: 8,
      answered: 6,
      correct: 3,
      mastery: 50,
    });
    expect(progress.get('untouched')).toEqual({
      answeredQuestionCount: 0,
      questionCount: 3,
      answered: 0,
      correct: 0,
      mastery: null,
    });
  });

  it('should never report more answered questions than published questions', async () => {
    repository.aggregateSubtreeAnswers.mockResolvedValue([
      answers({
        knowledgePointId: 'leaf',
        answered: 3,
        correct: 3,
        recentAnswered: 3,
        recentCorrect: 3,
        answeredQuestionCount: 3,
      }),
    ]);
    repository.countSubtreeQuestions.mockResolvedValue([{ knowledgePointId: 'leaf', questionCount: 2 }]);

    expect((await service.findProgress(7, 'sub1')).get('leaf')).toMatchObject({
      answeredQuestionCount: 2,
      questionCount: 2,
    });
  });

  it('should cache answer aggregates per user until invalidated and question counts per subject', async () => {
    await service.findProgress(7, 'sub1');
    await service.findProgress(7, 'sub1');
    expect(repository.aggregateSubtreeAnswers).toHaveBeenCalledTimes(1);
    expect(repository.countSubtreeQuestions).toHaveBeenCalledTimes(1);

    await service.findProgress(8, 'sub1');
    expect(repository.aggregateSubtreeAnswers).toHaveBeenCalledTimes(2);
    expect(repository.countSubtreeQuestions).toHaveBeenCalledTimes(1);

    await service.invalidate(7);
    await service.findProgress(7, 'sub1');
    expect(repository.aggregateSubtreeAnswers).toHaveBeenCalledTimes(3);
    expect(repository.countSubtreeQuestions).toHaveBeenCalledTimes(1);
  });

  it('should list leaves answered at least five times with mastery below 60 in ascending mastery', async () => {
    repository.findLeafStats.mockResolvedValue([
      leafStat('mid', 8, [1, 1, 1, 0, 0, 0, 0, 1]),
      leafStat('few', 4, [0, 0, 0, 0]),
      leafStat('low', 8, [0, 0, 0, 0, 0, 0, 0, 1]),
      leafStat('strong', 8, [1, 1, 1, 1, 1, 1, 1, 0]),
    ]);

    await expect(service.findWeakPoints(7, 'sub1')).resolves.toEqual([
      { knowledgePointId: 'low', answered: 8, correct: 1, mastery: 12.5 },
      { knowledgePointId: 'mid', answered: 8, correct: 4, mastery: 50 },
    ]);
    await expect(service.findWeakKnowledgePointIds(7, 'sub1')).resolves.toEqual(['low', 'mid']);
  });
});
