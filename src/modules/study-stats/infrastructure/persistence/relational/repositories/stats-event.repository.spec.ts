import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { StatsEventRelationalRepository } from './stats-event.repository';
import { entityManagerOf } from '../../../../../../common/database/transaction-handle';

const RECORD = { id: 'r1', userId: 7, questionId: 'q1', isCorrect: true };

const failure = (code: string): QueryFailedError =>
  new QueryFailedError('UPDATE', [], Object.assign(new Error(code), { code }));

function setup(respond: (sql: string, params: unknown[]) => Promise<unknown>) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: vi.fn((sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return respond(sql, params);
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn((work: (inner: EntityManager) => Promise<unknown>) => work(manager)),
  } as unknown as DataSource;
  return { queries, manager, dataSource, repository: new StatsEventRelationalRepository(dataSource) };
}

describe('StatsEventRelationalRepository', () => {
  describe('claimRecord', () => {
    it('should claim the record with a conditional update', async () => {
      const { queries, repository } = setup(() => Promise.resolve([[], 1]));

      await expect(repository.transaction((tx) => tx.claimRecord('r1'))).resolves.toBe(true);

      expect(queries[0].sql).toContain('"statsAppliedAt" IS NULL AND "isCorrect" IS NOT NULL');
      expect(queries[0].params).toEqual(['r1']);
    });

    it('should report not claimed when no row is affected', async () => {
      const { repository } = setup(() => Promise.resolve([[], 0]));

      await expect(repository.transaction((tx) => tx.claimRecord('r1'))).resolves.toBe(false);
    });
  });

  describe('findRecord', () => {
    it('should reread the graded record with session, question type and leaf knowledge points', async () => {
      const { queries, repository } = setup(() => Promise.resolve([{ id: 'r1', knowledgePointIds: ['kp1'] }]));

      await expect(repository.transaction((tx) => tx.findRecord('r1'))).resolves.toEqual({
        id: 'r1',
        knowledgePointIds: ['kp1'],
      });

      expect(queries[0].sql).toContain('kp."isLeaf"');
      expect(queries[0].sql).toContain('r."isCorrect" IS NOT NULL');
    });

    it('should expose a handle bound to the transaction entity manager', async () => {
      const { manager, repository } = setup(() => Promise.resolve([]));

      await expect(repository.transaction((tx) => Promise.resolve(entityManagerOf(tx.handle)))).resolves.toBe(manager);
    });
  });

  describe('markFirstForQuestion', () => {
    it('should mark the first answer and increment question stats inside a savepoint', async () => {
      const { queries, repository } = setup((sql) => Promise.resolve(sql.startsWith('UPDATE') ? [[], 1] : []));

      await expect(repository.transaction((tx) => tx.markFirstForQuestion(RECORD))).resolves.toBe(true);

      expect(queries.map((query) => query.sql)).toEqual([
        'SAVEPOINT "first_for_question"',
        expect.stringContaining('SET "firstForQuestion" = true'),
        expect.stringContaining('"statAnswered" = "statAnswered" + 1, "statCorrect" = "statCorrect" + $2'),
        'RELEASE SAVEPOINT "first_for_question"',
      ]);
      expect(queries[2].params).toEqual(['q1', 1]);
    });

    it('should increment only answered count for a wrong answer', async () => {
      const { queries, repository } = setup((sql) => Promise.resolve(sql.startsWith('UPDATE') ? [[], 1] : []));

      await repository.transaction((tx) => tx.markFirstForQuestion({ ...RECORD, isCorrect: false }));

      expect(queries[2].params).toEqual(['q1', 0]);
    });

    it('should not increment question stats when the question was counted before', async () => {
      const { queries, repository } = setup((sql) => Promise.resolve(sql.startsWith('UPDATE') ? [[], 0] : []));

      await expect(repository.transaction((tx) => tx.markFirstForQuestion(RECORD))).resolves.toBe(false);

      expect(queries.some((query) => query.sql.includes('"statAnswered"'))).toBe(false);
    });

    it('should roll back to the savepoint and report not first on a unique violation', async () => {
      const { queries, repository } = setup((sql) =>
        sql.includes('"firstForQuestion" = true') ? Promise.reject(failure('23505')) : Promise.resolve([]),
      );

      await expect(repository.transaction((tx) => tx.markFirstForQuestion(RECORD))).resolves.toBe(false);

      expect(queries.map((query) => query.sql)).toEqual([
        'SAVEPOINT "first_for_question"',
        expect.stringContaining('SET "firstForQuestion" = true'),
        'ROLLBACK TO SAVEPOINT "first_for_question"',
      ]);
    });

    it('should rethrow other errors', async () => {
      const { repository } = setup((sql) =>
        sql.includes('"firstForQuestion" = true') ? Promise.reject(failure('57014')) : Promise.resolve([]),
      );

      await expect(repository.transaction((tx) => tx.markFirstForQuestion(RECORD))).rejects.toBeInstanceOf(
        QueryFailedError,
      );
    });
  });

  describe('transaction', () => {
    it('should retry the whole transaction on deadlock', async () => {
      const { dataSource, repository } = setup(() => Promise.resolve([]));
      vi.mocked(dataSource.transaction)
        .mockRejectedValueOnce(failure('40P01'))
        .mockImplementationOnce(() => Promise.resolve('ok'));

      await expect(repository.transaction(() => Promise.resolve('ok'))).resolves.toBe('ok');

      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    });
  });
});
