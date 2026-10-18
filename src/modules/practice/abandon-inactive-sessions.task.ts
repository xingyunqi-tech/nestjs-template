import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { PracticeMode } from './domain/practice-mode';

const TASK_NAME = 'abandon-inactive-practice-sessions';
const LOCK_TTL_MS = 10 * 60 * 1000;
const INACTIVE_DAYS = 7;
const BATCH_SIZE = 500;
const DAY_MS = 86_400_000;

/** lastActiveAt 超过 7 天的非限时会话（每日一练除外）置为 ABANDONED */
@Injectable()
export class AbandonInactiveSessionsTask {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly practiceSessionRepository: PracticeSessionRepository,
  ) {}

  @Cron('20 * * * *', { name: TASK_NAME, timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () =>
        this.practiceSessionRepository.abandonInactive(
          new Date(Date.now() - INACTIVE_DAYS * DAY_MS),
          [PracticeMode.DAILY, PracticeMode.MOCK],
          BATCH_SIZE,
        ),
      );
      if (run.executed) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} sessions abandoned`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
