import { Job } from 'bullmq';
import { AccountCleanupQueueProcessor } from './account-cleanup-queue.processor';
import { AccountCleanupJobData } from './account-cleanup-queue.constants';
import { AccountCleanupRunner } from '../../../modules/account-cleanup/account-cleanup.runner';

describe('AccountCleanupQueueProcessor', () => {
  const job = (attemptsMade: number): Job<AccountCleanupJobData> =>
    ({ data: { userId: 7 }, attemptsMade, opts: { attempts: 3 } }) as unknown as Job<AccountCleanupJobData>;

  const runner = (run: () => Promise<void>) => ({
    run: vi.fn(run),
    reportFailure: vi.fn().mockResolvedValue(undefined),
  });

  it('should run the cleanup of the user of the job', async () => {
    const current = runner(() => Promise.resolve());

    await new AccountCleanupQueueProcessor(current as unknown as AccountCleanupRunner).process(job(0));

    expect(current.run).toHaveBeenCalledWith(7);
  });

  it('should rethrow for a retry before the last attempt', async () => {
    const current = runner(() => Promise.reject(new Error('busy')));

    await expect(
      new AccountCleanupQueueProcessor(current as unknown as AccountCleanupRunner).process(job(1)),
    ).rejects.toThrow('busy');
    expect(current.reportFailure).not.toHaveBeenCalled();
  });

  it('should report the failure on the last attempt', async () => {
    const error = new Error('busy');
    const current = runner(() => Promise.reject(error));

    await expect(
      new AccountCleanupQueueProcessor(current as unknown as AccountCleanupRunner).process(job(2)),
    ).rejects.toThrow('busy');
    expect(current.reportFailure).toHaveBeenCalledWith(7, error);
  });
});
