import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { DailyQuestionSetsService } from './daily-question-sets.service';

const TASK_NAME = 'daily-question-sets';
const LOCK_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class GenerateDailyQuestionSetsTask {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly dailyQuestionSetsService: DailyQuestionSetsService,
  ) {}

  @Cron('5 0 * * *', { name: TASK_NAME, timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () =>
        this.dailyQuestionSetsService.generateForPublishedSubjects(),
      );
      if (run.executed) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} daily sets ready`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
