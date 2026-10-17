import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateImportInput, ImportRequester, ImportsService } from './imports.service';
import { ImportJob } from './domain/import-job';
import {
  IMPORT_JOB_NAME,
  IMPORT_QUEUE,
  ImportQueueJobData,
} from '../../infrastructure/queue/import-queue/import-queue.constants';

@Injectable()
export class ImportLauncher {
  private readonly logger = new Logger(ImportLauncher.name);

  constructor(
    private readonly importsService: ImportsService,
    @Optional() @InjectQueue(IMPORT_QUEUE) private readonly importQueue?: Queue<ImportQueueJobData>,
  ) {}

  async launch(input: CreateImportInput, requester: ImportRequester): Promise<ImportJob> {
    const job = await this.importsService.create(input, requester);
    if (this.importQueue) {
      await this.importQueue.add(
        IMPORT_JOB_NAME,
        { importJobId: job.id },
        { jobId: job.id, attempts: 1, removeOnComplete: 100, removeOnFail: 1000 },
      );
    } else {
      setImmediate(() => {
        this.importsService
          .execute(job.id)
          .catch((error: unknown) => this.logger.error(`Import job ${job.id} crashed: ${String(error)}`));
      });
    }
    return job;
  }
}
