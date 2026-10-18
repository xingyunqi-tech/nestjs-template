import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { MockExamService } from './mock-exam.service';

const TASK_NAME = 'auto-submit-mock-sessions';
const LOCK_TTL_MS = 4 * 60 * 1000;
const BATCH_SIZE = 100;
const MAX_BATCHES = 20;

/** 兜底扫描已过自动交卷时间仍在进行中的模考 */
@Injectable()
export class AutoSubmitMockSessionsTask {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly mockExamService: MockExamService,
  ) {}

  @Cron('*/5 * * * *', { name: TASK_NAME, timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () => this.submitDue(new Date()));
      if (run.executed) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} sessions processed`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** 返回处理的会话数；单个会话失败不影响其他会话 */
  async submitDue(now: Date): Promise<number> {
    let processed = 0;
    const failed = new Set<string>();
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const ids = (await this.practiceSessionRepository.findDueMockIds(now, BATCH_SIZE + failed.size)).filter(
        (id) => !failed.has(id),
      );
      for (const id of ids) {
        try {
          await this.mockExamService.autoSubmit(id);
          processed += 1;
        } catch (error) {
          failed.add(id);
          this.schedulerService.logTaskError(
            TASK_NAME,
            new Error(`session ${id}: ${error instanceof Error ? error.message : String(error)}`),
          );
        }
      }
      if (ids.length < BATCH_SIZE) {
        return processed;
      }
    }
    return processed;
  }
}
