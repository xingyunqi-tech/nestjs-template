import type { Mocked } from 'vitest';
import { AutoSubmitMockSessionsTask } from './auto-submit-mock-sessions.task';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { MockExamService } from './mock-exam.service';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('AutoSubmitMockSessionsTask', () => {
  let scheduler: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let repository: Mocked<Pick<PracticeSessionRepository, 'findDueMockIds'>>;
  let mockExamService: Mocked<Pick<MockExamService, 'autoSubmit'>>;
  let task: AutoSubmitMockSessionsTask;

  beforeEach(() => {
    scheduler = {
      runExclusive: vi.fn(async (_key, _ttl, work) => ({ executed: true as const, result: await work() })) as never,
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    };
    repository = { findDueMockIds: vi.fn().mockResolvedValue(['s1', 's2']) };
    mockExamService = { autoSubmit: vi.fn().mockResolvedValue(undefined) };
    task = new AutoSubmitMockSessionsTask(
      scheduler as unknown as SchedulerService,
      repository as unknown as PracticeSessionRepository,
      mockExamService as unknown as MockExamService,
    );
  });

  it('should submit due sessions exclusively', async () => {
    await task.handle();

    expect(scheduler.runExclusive).toHaveBeenCalledWith(
      'auto-submit-mock-sessions',
      expect.any(Number),
      expect.any(Function),
    );
    expect(mockExamService.autoSubmit.mock.calls).toEqual([['s1'], ['s2']]);
    expect(scheduler.logTaskExecution).toHaveBeenCalledWith('auto-submit-mock-sessions', '2 sessions processed');
  });

  it('should continue with other sessions when one fails', async () => {
    mockExamService.autoSubmit.mockRejectedValueOnce(new Error('boom'));

    await expect(task.submitDue(new Date())).resolves.toBe(1);

    expect(mockExamService.autoSubmit).toHaveBeenCalledTimes(2);
    expect(scheduler.logTaskError).toHaveBeenCalledTimes(1);
  });
});
