import type { Mocked } from 'vitest';
import { ErrataWatchdogTask } from './errata-watchdog.task';
import { ErrataService } from './errata.service';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('ErrataWatchdogTask', () => {
  let schedulerService: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let errataService: Mocked<Pick<ErrataService, 'resumeStale'>>;
  let task: ErrataWatchdogTask;

  beforeEach(() => {
    schedulerService = {
      runExclusive: vi.fn(async (_key, _ttl, work: () => Promise<unknown>) => ({
        executed: true,
        result: await work(),
      })),
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    } as never;
    errataService = { resumeStale: vi.fn().mockResolvedValue(1) };
    task = new ErrataWatchdogTask(
      schedulerService as unknown as SchedulerService,
      errataService as unknown as ErrataService,
    );
  });

  it('should dispatch stale errata exclusively', async () => {
    await task.handle();

    expect(schedulerService.runExclusive).toHaveBeenCalledWith(
      'errata-watchdog',
      expect.any(Number),
      expect.any(Function),
    );
    expect(errataService.resumeStale).toHaveBeenCalledTimes(1);
    expect(schedulerService.logTaskExecution).toHaveBeenCalledTimes(1);
  });

  it('should log errors without throwing', async () => {
    errataService.resumeStale.mockRejectedValue(new Error('db down'));

    await expect(task.handle()).resolves.toBeUndefined();
    expect(schedulerService.logTaskError).toHaveBeenCalledTimes(1);
  });
});
