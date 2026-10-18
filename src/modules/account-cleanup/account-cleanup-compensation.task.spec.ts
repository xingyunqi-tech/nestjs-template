import type { Mocked } from 'vitest';
import { AccountCleanupCompensationTask } from './account-cleanup-compensation.task';
import { AccountCleanupRepository } from './infrastructure/persistence/account-cleanup.repository';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { AccountCleanupProducer } from '../../infrastructure/account-cleanup/account-cleanup.producer';

describe('AccountCleanupCompensationTask', () => {
  let scheduler: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let repository: Mocked<Pick<AccountCleanupRepository, 'findPendingUserIds'>>;
  let producer: Mocked<Pick<AccountCleanupProducer, 'enqueueCleanup'>>;
  let task: AccountCleanupCompensationTask;

  beforeEach(() => {
    scheduler = {
      runExclusive: vi.fn(async (_key, _ttl, work) => ({ executed: true as const, result: await work() })) as never,
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    };
    repository = { findPendingUserIds: vi.fn().mockResolvedValue([3, 8]) };
    producer = { enqueueCleanup: vi.fn().mockResolvedValue(undefined) };
    task = new AccountCleanupCompensationTask(
      scheduler as unknown as SchedulerService,
      repository as unknown as AccountCleanupRepository,
      producer as unknown as AccountCleanupProducer,
    );
  });

  it('should enqueue deleted users without a completed cleanup after a grace period', async () => {
    const before = Date.now();
    await task.handle();
    const after = Date.now();

    const [deletedBefore, limit] = repository.findPendingUserIds.mock.calls[0];
    expect(deletedBefore.getTime()).toBeGreaterThanOrEqual(before - 30 * 60_000);
    expect(deletedBefore.getTime()).toBeLessThanOrEqual(after - 30 * 60_000);
    expect(limit).toBe(200);
    expect(producer.enqueueCleanup.mock.calls).toEqual([[3], [8]]);
    expect(scheduler.logTaskExecution).toHaveBeenCalledWith(
      'account-cleanup-compensation',
      '2 account cleanups enqueued',
    );
  });

  it('should log errors without throwing', async () => {
    repository.findPendingUserIds.mockRejectedValue(new Error('db down'));

    await expect(task.handle()).resolves.toBeUndefined();
    expect(scheduler.logTaskError).toHaveBeenCalled();
  });
});
