import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MOCK_SUBMIT_JOB_NAME,
  MOCK_SUBMIT_QUEUE,
  MockSubmitJobData,
} from '../../infrastructure/queue/mock-submit-queue/mock-submit-queue.constants';

/** 模考自动交卷延时任务；入队失败或未启用队列时由兜底扫描处理 */
@Injectable()
export class MockSubmitScheduler {
  private readonly logger = new Logger(MockSubmitScheduler.name);

  constructor(@Optional() @InjectQueue(MOCK_SUBMIT_QUEUE) private readonly queue?: Queue<MockSubmitJobData>) {}

  async schedule(sessionId: string, runAt: Date): Promise<void> {
    if (!this.queue) {
      return;
    }
    try {
      await this.queue.add(
        MOCK_SUBMIT_JOB_NAME,
        { sessionId },
        {
          jobId: sessionId,
          delay: Math.max(0, runAt.getTime() - Date.now()),
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to schedule auto submit for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
