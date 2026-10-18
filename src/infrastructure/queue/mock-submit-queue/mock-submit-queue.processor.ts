import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { MOCK_SUBMIT_QUEUE, MockSubmitJobData } from './mock-submit-queue.constants';
import { MockExamService } from '../../../modules/practice/mock-exam.service';

@Processor(MOCK_SUBMIT_QUEUE)
export class MockSubmitQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(MockSubmitQueueProcessor.name);

  constructor(private readonly mockExamService: MockExamService) {
    super();
  }

  /** 提前触发时按自动交卷时间重新延时，保留同一 jobId */
  async process(job: Job<MockSubmitJobData>, token?: string): Promise<void> {
    const notDueUntil = await this.mockExamService.autoSubmit(job.data.sessionId);
    if (notDueUntil) {
      await job.moveToDelayed(notDueUntil.getTime(), token);
      throw new DelayedError();
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Mock submit job ${job?.id} failed: ${error.message}`);
  }
}
