import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { PracticeSessionRelationalRepository } from './practice-session.repository';
import { PracticeSessionEntity } from '../entities/practice-session.entity';
import { AnswerRecordEntity } from '../entities/answer-record.entity';

const SESSION = { id: 's1', userId: 3, paperId: 'p1' };

function setup(execute: () => Promise<unknown>) {
  const queries: string[] = [];
  const builder = {
    update: () => builder,
    set: () => builder,
    where: () => builder,
    andWhere: () => builder,
    execute,
  };
  const manager = {
    query: vi.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve([]);
    }),
    createQueryBuilder: () => builder,
  } as unknown as EntityManager;
  const sessionRepository = {
    manager: { transaction: (work: (inner: EntityManager) => Promise<unknown>) => work(manager) },
  } as unknown as Repository<PracticeSessionEntity>;
  const repository = new PracticeSessionRelationalRepository(sessionRepository, {} as Repository<AnswerRecordEntity>);
  return { queries, repository };
}

const failure = (code: string): QueryFailedError =>
  new QueryFailedError('UPDATE', [], Object.assign(new Error(code), { code }));

describe('PracticeSessionRelationalRepository.markFirstAttempt', () => {
  it('should mark the session and increment the paper attempt count inside a savepoint', async () => {
    const { queries, repository } = setup(() => Promise.resolve({ affected: 1 }));

    await expect(repository.transaction((tx) => tx.markFirstAttempt(SESSION))).resolves.toBe(true);

    expect(queries).toEqual([
      'SAVEPOINT "first_attempt"',
      expect.stringContaining('"attemptCount" = "attemptCount" + 1'),
      'RELEASE SAVEPOINT "first_attempt"',
    ]);
  });

  it('should roll back to the savepoint and report not first on a unique violation', async () => {
    const { queries, repository } = setup(() => Promise.reject(failure('23505')));

    await expect(repository.transaction((tx) => tx.markFirstAttempt(SESSION))).resolves.toBe(false);

    expect(queries).toEqual(['SAVEPOINT "first_attempt"', 'ROLLBACK TO SAVEPOINT "first_attempt"']);
  });

  it('should rethrow other errors', async () => {
    const { repository } = setup(() => Promise.reject(failure('57014')));

    await expect(repository.transaction((tx) => tx.markFirstAttempt(SESSION))).rejects.toBeInstanceOf(QueryFailedError);
  });
});
