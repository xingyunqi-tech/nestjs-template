import type { Mocked } from 'vitest';
import { LearningStatsService } from './learning-stats.service';
import { LearningStatsRepository } from './infrastructure/persistence/learning-stats.repository';
import { KnowledgeMasteryService } from './knowledge-mastery.service';
import { StatsRecord } from './domain/stats-record';
import { PracticeMode } from '../practice/domain/practice-mode';
import { QuestionType } from '../questions/domain/question-type';
import { TransactionHandle } from '../../common/database/transaction-handle';

const record = (overrides: Partial<StatsRecord> = {}): StatsRecord => ({
  id: 'r1',
  sessionId: 's1',
  userId: 7,
  subjectId: 'sub1',
  mode: PracticeMode.RANDOM,
  questionId: 'q1',
  questionType: QuestionType.SINGLE,
  questionSubjectId: 'sub1',
  knowledgePointIds: ['kp1', 'kp2'],
  answer: { keys: ['A'] },
  isCorrect: true,
  isPartial: false,
  selfAssessment: null,
  durationSec: 12,
  gradedAt: new Date('2026-10-16T16:30:00Z'),
  statDate: '2026-10-17',
  firstForQuestion: false,
  ...overrides,
});

describe('LearningStatsService', () => {
  const handle = {} as TransactionHandle;
  let repository: Mocked<LearningStatsRepository>;
  let mastery: Mocked<Pick<KnowledgeMasteryService, 'invalidate'>>;
  let service: LearningStatsService;

  beforeEach(() => {
    repository = {
      applyKnowledgeResult: vi.fn().mockResolvedValue(undefined),
      addDailyStat: vi.fn().mockResolvedValue(undefined),
      rebuildKnowledgeStats: vi.fn().mockResolvedValue(undefined),
      claimMockSessionDuration: vi.fn().mockResolvedValue(null),
      findLeafStats: vi.fn(),
      aggregateSubtreeAnswers: vi.fn(),
      countSubtreeQuestions: vi.fn(),
      findDailyStats: vi.fn(),
      sumDailyStats: vi.fn(),
    };
    mastery = { invalidate: vi.fn().mockResolvedValue(undefined) };
    service = new LearningStatsService(repository, mastery as unknown as KnowledgeMasteryService);
  });

  it('should update leaf knowledge points and add the answer duration to the stat date', async () => {
    await service.apply(handle, record());

    expect(repository.applyKnowledgeResult).toHaveBeenCalledWith(handle, {
      userId: 7,
      knowledgePointIds: ['kp1', 'kp2'],
      isCorrect: true,
      answeredAt: new Date('2026-10-16T16:30:00Z'),
    });
    expect(repository.addDailyStat).toHaveBeenCalledTimes(1);
    expect(repository.addDailyStat).toHaveBeenCalledWith(handle, {
      userId: 7,
      date: '2026-10-17',
      subjectId: 'sub1',
      answered: 1,
      correct: 1,
      durationSec: 12,
    });
    expect(repository.claimMockSessionDuration).not.toHaveBeenCalled();
  });

  it('should count a late-night answer without stat date on the Asia/Shanghai day', async () => {
    await service.apply(handle, record({ statDate: null, isCorrect: false }));

    expect(repository.addDailyStat).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({ date: '2026-10-17', answered: 1, correct: 0 }),
    );
  });

  it('should add the mock session duration once on the submission day instead of per answer duration', async () => {
    repository.claimMockSessionDuration
      .mockResolvedValueOnce({ date: '2026-10-18', subjectId: 'sub1', durationSec: 5400 })
      .mockResolvedValueOnce(null);

    await service.apply(handle, record({ id: 'a', mode: PracticeMode.MOCK, statDate: '2026-10-18' }));
    await service.apply(handle, record({ id: 'b', mode: PracticeMode.MOCK, statDate: '2026-10-18' }));

    expect(repository.claimMockSessionDuration.mock.calls).toEqual([
      [handle, 's1', 'a'],
      [handle, 's1', 'b'],
    ]);
    expect(repository.addDailyStat.mock.calls.map(([, delta]) => delta)).toEqual([
      { userId: 7, date: '2026-10-18', subjectId: 'sub1', answered: 1, correct: 1, durationSec: 0 },
      { userId: 7, date: '2026-10-18', subjectId: 'sub1', answered: 0, correct: 0, durationSec: 5400 },
      { userId: 7, date: '2026-10-18', subjectId: 'sub1', answered: 1, correct: 1, durationSec: 0 },
    ]);
  });

  it('should invalidate the knowledge cache of the user after commit and ignore cache failures', async () => {
    await service.afterCommit(record());
    expect(mastery.invalidate).toHaveBeenCalledWith(7);

    mastery.invalidate.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.afterCommit(record())).resolves.toBeUndefined();
  });
});
