import type { Mocked } from 'vitest';
import { ImportJobWatchdogTask } from './import-job-watchdog.task';
import { ImportsService } from './imports.service';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('ImportJobWatchdogTask', () => {
  let schedulerService: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let importsService: Mocked<Pick<ImportsService, 'failStaleJobs'>>;
  let task: ImportJobWatchdogTask;

  beforeEach(() => {
    schedulerService = {
      runExclusive: vi.fn(async (_key, _ttl, work: () => Promise<unknown>) => ({
        executed: true,
        result: await work(),
      })),
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    } as never;
    importsService = { failStaleJobs: vi.fn().mockResolvedValue(2) };
    task = new ImportJobWatchdogTask(
      schedulerService as unknown as SchedulerService,
      importsService as unknown as ImportsService,
    );
  });

  it('should fail stale jobs exclusively', async () => {
    await task.handle();

    expect(schedulerService.runExclusive).toHaveBeenCalledWith(
      'import-job-watchdog',
      expect.any(Number),
      expect.any(Function),
    );
    expect(importsService.failStaleJobs).toHaveBeenCalledTimes(1);
    expect(schedulerService.logTaskExecution).toHaveBeenCalledTimes(1);
  });

  it('should log errors without throwing', async () => {
    importsService.failStaleJobs.mockRejectedValue(new Error('db down'));

    await expect(task.handle()).resolves.toBeUndefined();
    expect(schedulerService.logTaskError).toHaveBeenCalledTimes(1);
  });
});
