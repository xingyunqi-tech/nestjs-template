import type { Mock } from 'vitest';
import { GenerateDailyQuestionSetsTask } from './generate-daily-question-sets.task';
import { DailyQuestionSetsService } from './daily-question-sets.service';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';

describe('GenerateDailyQuestionSetsTask', () => {
  let runExclusive: Mock;
  let logTaskError: Mock;
  let generateForPublishedSubjects: Mock;
  let task: GenerateDailyQuestionSetsTask;

  beforeEach(() => {
    runExclusive = vi.fn(async (_key: string, _ttl: number, run: () => Promise<unknown>) => ({
      executed: true,
      result: await run(),
    }));
    logTaskError = vi.fn();
    generateForPublishedSubjects = vi.fn().mockResolvedValue(2);
    task = new GenerateDailyQuestionSetsTask(
      { runExclusive, logTaskError, logTaskExecution: vi.fn() } as unknown as SchedulerService,
      { generateForPublishedSubjects } as unknown as DailyQuestionSetsService,
    );
  });

  it('should generate daily sets under the exclusive lock', async () => {
    await task.handle();

    expect(runExclusive).toHaveBeenCalledWith('daily-question-sets', 600_000, expect.any(Function));
    expect(generateForPublishedSubjects).toHaveBeenCalled();
  });

  it('should log failures without throwing', async () => {
    runExclusive.mockRejectedValue(new Error('redis down'));

    await expect(task.handle()).resolves.toBeUndefined();
    expect(logTaskError).toHaveBeenCalled();
  });
});
