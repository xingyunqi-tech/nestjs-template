import type { Mocked } from 'vitest';
import { StatsEventService, statsUserLockKey } from './stats-event.service';
import { StatsEventRepository, StatsEventTransaction } from './infrastructure/persistence/stats-event.repository';
import { StatsRecord } from './domain/stats-record';
import { LockService } from '../../infrastructure/redis/lock.service';
import { WrongBookUpdater } from './ports/wrong-book.updater';
import { LearningStatsUpdater } from './ports/learning-stats.updater';
import { CheckInEvaluator } from './ports/check-in.evaluator';
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
  knowledgePointIds: ['kp1'],
  answer: { keys: ['A'] },
  isCorrect: true,
  isPartial: false,
  selfAssessment: null,
  durationSec: 12,
  gradedAt: new Date('2026-10-17T02:00:00Z'),
  statDate: '2026-10-17',
  firstForQuestion: false,
  ...overrides,
});

/** 以内存状态模拟 statsAppliedAt 与首次作答标记 */
function createStore(records: StatsRecord[]) {
  const applied = new Set<string>();
  const graded = new Map(records.map((item) => [item.id, item]));
  const firsts = new Set<string>();
  const handle = {} as TransactionHandle;
  const tx: Mocked<StatsEventTransaction> = {
    handle,
    claimRecord: vi.fn((id: string) => {
      if (applied.has(id) || !graded.has(id)) {
        return Promise.resolve(false);
      }
      applied.add(id);
      return Promise.resolve(true);
    }),
    findRecord: vi.fn((id: string) => Promise.resolve(graded.get(id) ?? null)),
    markFirstForQuestion: vi.fn((item) => {
      const key = `${item.userId}:${item.questionId}`;
      if (firsts.has(key)) {
        return Promise.resolve(false);
      }
      firsts.add(key);
      return Promise.resolve(true);
    }),
  };
  return { tx, handle, applied, firsts };
}

describe('StatsEventService', () => {
  let repository: Mocked<StatsEventRepository>;
  let lockService: Mocked<Pick<LockService, 'tryAcquire' | 'release'>>;
  let calls: string[];
  let steps: { wrongBook: WrongBookUpdater; learning: LearningStatsUpdater; checkIn: CheckInEvaluator };
  let service: StatsEventService;
  let store: ReturnType<typeof createStore>;

  const build = (records: StatsRecord[]): void => {
    store = createStore(records);
    store.tx.markFirstForQuestion.mockImplementationOnce(async (item) => {
      calls.push(`first:${item.id}`);
      return true;
    });
    repository = {
      findRecordUserId: vi.fn((id: string) => Promise.resolve(records.find((item) => item.id === id)?.userId ?? null)),
      findPendingSessionRecords: vi.fn().mockResolvedValue(records.map(({ id, userId }) => ({ id, userId }))),
      findStalePendingRecords: vi.fn(),
      transaction: vi.fn((work) => work(store.tx)) as never,
    };
    service = new StatsEventService(
      repository,
      lockService as unknown as LockService,
      steps.wrongBook,
      steps.learning,
      steps.checkIn,
    );
  };

  beforeEach(() => {
    calls = [];
    lockService = { tryAcquire: vi.fn().mockResolvedValue('token'), release: vi.fn().mockResolvedValue(undefined) };
    const step = (name: string) => ({
      apply: vi.fn(async (_handle: TransactionHandle, item: StatsRecord) => {
        calls.push(`${name}:${item.id}`);
      }),
      afterCommit: vi.fn(async (item: StatsRecord) => {
        calls.push(`${name}.afterCommit:${item.id}`);
      }),
    });
    steps = {
      wrongBook: step('wrongBook'),
      learning: step('learning'),
      checkIn: {
        ...step('checkIn'),
        evaluate: vi.fn(async (_handle: TransactionHandle, userId: number, date: string) => {
          calls.push(`checkIn.evaluate:${userId}:${date}`);
        }),
      },
    };
    build([record()]);
  });

  it('should apply wrong book, learning stats, check-in and first answer in order under the user lock', async () => {
    await expect(service.processRecord('r1')).resolves.toBe('done');

    expect(calls).toEqual(['wrongBook:r1', 'learning:r1', 'checkIn:r1', 'first:r1', 'learning.afterCommit:r1']);
    expect(store.tx.claimRecord).toHaveBeenCalledWith('r1');
    expect(store.tx.findRecord).toHaveBeenCalledWith('r1');
    expect(steps.wrongBook.apply).toHaveBeenCalledWith(store.handle, record());
    expect(lockService.tryAcquire).toHaveBeenCalledWith(statsUserLockKey(7), expect.any(Number));
    expect(lockService.release).toHaveBeenCalledWith('stats:user:7', 'token');
  });

  it('should make no further changes when the same record is processed again', async () => {
    await service.processRecord('r1');
    calls = [];

    await expect(service.processRecord('r1')).resolves.toBe('done');

    expect(calls).toEqual([]);
    expect(store.tx.findRecord).toHaveBeenCalledTimes(1);
    expect(store.tx.markFirstForQuestion).toHaveBeenCalledTimes(1);
  });

  it('should skip an ungraded record and leave it unapplied', async () => {
    build([]);
    repository.findRecordUserId.mockResolvedValue(7);

    await expect(service.processRecord('ungraded')).resolves.toBe('done');

    expect(store.tx.claimRecord).toHaveBeenCalledWith('ungraded');
    expect(store.applied.size).toBe(0);
    expect(store.tx.findRecord).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(steps.learning.afterCommit).not.toHaveBeenCalled();
  });

  it('should finish without locking when the record does not exist', async () => {
    await expect(service.processRecord('missing')).resolves.toBe('done');

    expect(lockService.tryAcquire).not.toHaveBeenCalled();
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('should return locked without opening a transaction when the user lock is taken', async () => {
    lockService.tryAcquire.mockResolvedValue(null);

    await expect(service.processRecord('r1')).resolves.toBe('locked');

    expect(repository.transaction).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('should release the user lock and rethrow when processing fails', async () => {
    vi.mocked(steps.learning.apply).mockRejectedValueOnce(new Error('db down'));

    await expect(service.processRecord('r1')).rejects.toThrow('db down');

    expect(lockService.release).toHaveBeenCalledWith('stats:user:7', 'token');
  });

  it('should count only one first answer among concurrent records of the same user and question', async () => {
    build([record({ id: 'a' }), record({ id: 'b' })]);

    const results = await Promise.all([service.applyRecord('a'), service.applyRecord('b')]);

    expect(results).toEqual([true, true]);
    expect(store.tx.markFirstForQuestion).toHaveBeenCalledTimes(2);
    expect(store.firsts.size).toBe(1);
  });

  describe('processCheckIn', () => {
    it('should evaluate the check-in in a transaction under the user lock', async () => {
      await expect(service.processCheckIn(7, '2026-10-17')).resolves.toBe('done');

      expect(calls).toEqual(['checkIn.evaluate:7:2026-10-17']);
      expect(steps.checkIn.evaluate).toHaveBeenCalledWith(store.handle, 7, '2026-10-17');
      expect(lockService.tryAcquire).toHaveBeenCalledWith(statsUserLockKey(7), expect.any(Number));
      expect(lockService.release).toHaveBeenCalledWith('stats:user:7', 'token');
    });

    it('should return locked without evaluating when the user lock is taken', async () => {
      lockService.tryAcquire.mockResolvedValue(null);

      await expect(service.processCheckIn(7, '2026-10-17')).resolves.toBe('locked');

      expect(repository.transaction).not.toHaveBeenCalled();
    });
  });

  describe('processSession', () => {
    it('should apply pending session records one by one under a single user lock', async () => {
      build([record({ id: 'a', questionId: 'q1' }), record({ id: 'b', questionId: 'q2' })]);

      await expect(service.processSession('s1')).resolves.toBe('done');

      expect(repository.findPendingSessionRecords).toHaveBeenCalledWith('s1');
      expect(lockService.tryAcquire).toHaveBeenCalledTimes(1);
      expect(store.tx.claimRecord.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
      expect(calls.filter((call) => call.startsWith('checkIn'))).toEqual(['checkIn:a', 'checkIn:b']);
    });

    it('should continue with remaining records when one fails and throw afterwards', async () => {
      build([record({ id: 'a' }), record({ id: 'b', questionId: 'q2' })]);
      vi.mocked(steps.wrongBook.apply).mockRejectedValueOnce(new Error('boom'));

      await expect(service.processSession('s1')).rejects.toThrow('boom');

      expect(calls).toContain('checkIn:b');
      expect(lockService.release).toHaveBeenCalledTimes(1);
    });

    it('should not lock when the session has no pending records', async () => {
      build([]);

      await expect(service.processSession('s1')).resolves.toBe('done');

      expect(lockService.tryAcquire).not.toHaveBeenCalled();
    });
  });
});
