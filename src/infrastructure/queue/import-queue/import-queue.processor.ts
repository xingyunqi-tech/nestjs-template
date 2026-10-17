import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { IMPORT_QUEUE, ImportQueueJobData } from './import-queue.constants';
import { ImportsService } from '../../../modules/imports/imports.service';

@Processor(IMPORT_QUEUE, { concurrency: 1 })
export class ImportQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportQueueProcessor.name);

  constructor(private readonly importsService: ImportsService) {
    super();
  }

  async process(job: Job<ImportQueueJobData>): Promise<void> {
    const execution = await this.importsService.execute(job.data.importJobId);
    if (execution) {
      this.logger.log(
        `Import job ${execution.job.id} ${execution.job.status}: ${execution.job.succeeded}/${execution.job.total} succeeded`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Import queue job ${job?.id} failed: ${error.message}`);
  }
}
