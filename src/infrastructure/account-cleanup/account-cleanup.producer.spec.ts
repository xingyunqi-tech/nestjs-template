import type { Mocked } from 'vitest';
import { Queue } from 'bullmq';
import { ModuleRef } from '@nestjs/core';
import { ACCOUNT_CLEANUP_JOB_ATTEMPTS, AccountCleanupProducer } from './account-cleanup.producer';
import { ACCOUNT_CLEANUP_FAILED_ALERT } from './account-cleanup-alert';
import {
  ACCOUNT_CLEANUP_JOB_NAME,
  AccountCleanupJobData,
} from '../queue/account-cleanup-queue/account-cleanup-queue.constants';
import { AlertReporter } from '../alerting/alert-reporter';

describe('AccountCleanupProducer', () => {
  let alertReporter: Mocked<AlertReporter>;
  let queue: { getJob: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };

  const existingJob = (state: string, remove = vi.fn().mockResolvedValue(undefined)) => ({
    getState: vi.fn().mockResolvedValue(state),
    remove,
  });

  const create = (withQueue = true): AccountCleanupProducer =>
    new AccountCleanupProducer(
      { get: () => alertReporter } as unknown as ModuleRef,
      withQueue ? (queue as unknown as Queue<AccountCleanupJobData>) : undefined,
    );

  beforeEach(() => {
    alertReporter = { raise: vi.fn().mockResolvedValue(null) };
    queue = { getJob: vi.fn().mockResolvedValue(undefined), add: vi.fn().mockResolvedValue(undefined) };
  });

  it('should enqueue a retryable job keyed by the user', async () => {
    await create().enqueueCleanup(7);

    expect(queue.add).toHaveBeenCalledWith(
      ACCOUNT_CLEANUP_JOB_NAME,
      { userId: 7 },
      expect.objectContaining({ jobId: 'user-7', attempts: ACCOUNT_CLEANUP_JOB_ATTEMPTS }),
    );
  });

  it('should not enqueue again while a job of the user is pending', async () => {
    queue.getJob.mockResolvedValue(existingJob('delayed'));

    await create().enqueueCleanup(7);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should replace a finished job of the user under the same job id', async () => {
    const job = existingJob('failed');
    queue.getJob.mockResolvedValue(job);

    await create().enqueueCleanup(7);

    expect(job.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      ACCOUNT_CLEANUP_JOB_NAME,
      { userId: 7 },
      expect.objectContaining({ jobId: 'user-7' }),
    );
  });

  it('should alert instead of enqueueing a second job when the finished job cannot be removed', async () => {
    queue.getJob.mockResolvedValue(existingJob('completed', vi.fn().mockRejectedValue(new Error('locked'))));

    await expect(create().enqueueCleanup(7)).resolves.toBeUndefined();

    expect(queue.add).not.toHaveBeenCalled();
    expect(alertReporter.raise).toHaveBeenCalledWith(
      ACCOUNT_CLEANUP_FAILED_ALERT,
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ userId: 7 }),
      `${ACCOUNT_CLEANUP_FAILED_ALERT}:7`,
    );
  });

  it('should alert when enqueueing fails', async () => {
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(create().enqueueCleanup(7)).resolves.toBeUndefined();

    expect(alertReporter.raise).toHaveBeenCalled();
  });

  it('should hand the cleanup to the in-process runner without a queue', async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const producer = create(false);
    producer.setInProcessRunner(runner);

    await producer.enqueueCleanup(7);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runner).toHaveBeenCalledWith(7);
  });
});
