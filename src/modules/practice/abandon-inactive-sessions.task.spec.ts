import type { Mocked } from 'vitest';
import { AbandonInactiveSessionsTask } from './abandon-inactive-sessions.task';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { PracticeMode } from './domain/practice-mode';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('AbandonInactiveSessionsTask', () => {
  let scheduler: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let repository: Mocked<Pick<PracticeSessionRepository, 'abandonInactive'>>;
  let task: AbandonInactiveSessionsTask;

  beforeEach(() => {
    scheduler = {
      runExclusive: vi.fn(async (_key, _ttl, work) => ({ executed: true as const, result: await work() })) as never,
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    };
    repository = { abandonInactive: vi.fn().mockResolvedValue(2) };
    task = new AbandonInactiveSessionsTask(
      scheduler as unknown as SchedulerService,
      repository as unknown as PracticeSessionRepository,
    );
  });

  it('should abandon sessions without a time limit inactive for seven days except daily practice', async () => {
    const before = Date.now();
    await task.handle();
    const after = Date.now();
    const [cutoff, excluded] = repository.abandonInactive.mock.calls[0];
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - 7 * 86_400_000);
    expect(excluded).toEqual([PracticeMode.DAILY, PracticeMode.MOCK]);
    expect(scheduler.runExclusive).toHaveBeenCalledWith(
      'abandon-inactive-practice-sessions',
      expect.any(Number),
      expect.any(Function),
    );
    expect(scheduler.logTaskExecution).toHaveBeenCalled();
  });

  it('should log failures without throwing', async () => {
    repository.abandonInactive.mockRejectedValue(new Error('db down'));
    await expect(task.handle()).resolves.toBeUndefined();
    expect(scheduler.logTaskError).toHaveBeenCalled();
  });
});
