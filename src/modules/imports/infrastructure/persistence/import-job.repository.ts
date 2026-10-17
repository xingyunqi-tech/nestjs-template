import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { ImportJob } from '../../domain/import-job';
import { ImportJobStatus } from '../../domain/import-job-status';
import { ImportProgress } from '../../domain/import-outcome';

export type CreateImportJobData = Pick<ImportJob, 'fileId' | 'publishOnImport' | 'createdBy'>;

export type FinishImportJobData = Partial<ImportProgress> &
  Pick<ImportJob, 'errorReportFileId' | 'failureReason'> & {
    status: ImportJobStatus.DONE | ImportJobStatus.FAILED;
  };

export abstract class ImportJobRepository {
  abstract create(data: CreateImportJobData): Promise<ImportJob>;

  abstract findById(id: ImportJob['id']): Promise<NullableType<ImportJob>>;

  abstract findManyWithPaginationAndCount(options: {
    status?: ImportJobStatus;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: ImportJob[]; total: number }>;

  /** 仅当任务待执行时置为执行中，返回是否抢到 */
  abstract start(id: ImportJob['id']): Promise<boolean>;

  abstract updateProgress(id: ImportJob['id'], progress: ImportProgress): Promise<void>;

  /** 将执行开始早于 runningBefore 或创建早于 pendingBefore 仍未结束的任务置为失败，返回这些任务 */
  abstract failStale(runningBefore: Date, pendingBefore: Date, failureReason: string): Promise<ImportJob[]>;

  abstract finish(id: ImportJob['id'], data: FinishImportJobData): Promise<ImportJob>;
}
