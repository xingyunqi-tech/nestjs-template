import type { Mocked } from 'vitest';
import { CleanupGeneratedPapersTask } from './cleanup-generated-papers.task';
import { PaperRepository } from './infrastructure/persistence/paper.repository';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('CleanupGeneratedPapersTask', () => {
  let scheduler: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let repository: Mocked<Pick<PaperRepository, 'removeStaleGenerated'>>;
  let task: CleanupGeneratedPapersTask;

  beforeEach(() => {
    scheduler = {
      runExclusive: vi.fn(async (_key, _ttl, work) => ({ executed: true as const, result: await work() })) as never,
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    };
    repository = { removeStaleGenerated: vi.fn().mockResolvedValue(3) };
    task = new CleanupGeneratedPapersTask(
      scheduler as unknown as SchedulerService,
      repository as unknown as PaperRepository,
    );
  });

  it('should remove never started generated papers older than seven days exclusively', async () => {
    const before = Date.now();
    await task.handle();
    const after = Date.now();

    const [cutoff] = repository.removeStaleGenerated.mock.calls[0];
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - 7 * 86_400_000);
    expect(scheduler.logTaskExecution).toHaveBeenCalledWith('cleanup-generated-papers', '3 generated papers removed');
  });

  it('should log errors without throwing', async () => {
    repository.removeStaleGenerated.mockRejectedValue(new Error('db down'));
    await expect(task.handle()).resolves.toBeUndefined();
    expect(scheduler.logTaskError).toHaveBeenCalled();
  });
});
