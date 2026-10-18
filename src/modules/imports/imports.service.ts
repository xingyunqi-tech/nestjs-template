import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { ImportJobRepository } from './infrastructure/persistence/import-job.repository';
import { ImportJob } from './domain/import-job';
import { ImportJobStatus } from './domain/import-job-status';
import { ImportProgress } from './domain/import-outcome';
import { ImportRowError } from './domain/import-row-error';
import { ContentImporter } from './content-importer';
import { buildErrorReport, ERROR_REPORT_FILE_NAME } from './error-report';
import { readImportPackage } from './package/import-package';
import { ImportPackageError } from './package/import-package-error';
import {
  IMPORT_FAILED_ALERT,
  IMPORT_INTERRUPTED_REASON,
  IMPORT_PACKAGE_LIMITS,
  IMPORT_PROGRESS_INTERVAL,
  IMPORT_STALE_TIMEOUTS,
} from './import.constants';
import { FilesService } from '../files/files.service';
import { FileStorageService } from '../files/file-storage.service';
import { FilePurpose } from '../files/domain/file-purpose';
import { FILE_PURPOSE_RULES } from '../files/file-purposes';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { Permission } from '../../core/permissions/permission.enum';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { AllConfigType } from '../../config/config.type';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';

export interface ImportRequester {
  id: number;
  roleId: RoleEnum | null;
}

export interface CreateImportInput {
  fileId?: string;
  upload?: { buffer: Buffer; originalname: string };
  publishOnImport: boolean;
}

export interface ImportExecution {
  job: ImportJob;
  errors: ImportRowError[];
}

export interface ImportErrorReport {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

const IMPORT_MIME_TYPES = new Set(Object.values(FILE_PURPOSE_RULES[FilePurpose.IMPORT].mimeTypes));
const REPORT_LANGUAGE = 'zh';

function importJobNotFound(): NotFoundException {
  return new NotFoundException({ error: 'importJobNotFound' });
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly importJobRepository: ImportJobRepository,
    private readonly contentImporter: ContentImporter,
    private readonly filesService: FilesService,
    private readonly fileStorageService: FileStorageService,
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService<AllConfigType>,
    @Optional() private readonly alertReporter?: AlertReporter,
    @Optional() private readonly i18n?: I18nService,
  ) {}

  async create(input: CreateImportInput, requester: ImportRequester): Promise<ImportJob> {
    if (input.publishOnImport && !(await this.canPublish(requester))) {
      throw new ForbiddenException({ error: 'importPublishForbidden' });
    }
    let fileId: string;
    if (input.upload) {
      fileId = (
        await this.fileStorageService.store(
          input.upload.buffer,
          input.upload.originalname,
          FilePurpose.IMPORT,
          requester.id,
        )
      ).id;
    } else if (input.fileId) {
      const file = await this.filesService.findAccessible(input.fileId, requester.id);
      if (!file.mimeType || !IMPORT_MIME_TYPES.has(file.mimeType)) {
        throw new UnprocessableEntityException({ errors: { fileId: 'cantUploadFileType' } });
      }
      fileId = file.id;
    } else {
      throw new UnprocessableEntityException({ errors: { file: 'selectFile' } });
    }

    return this.importJobRepository.create({
      fileId,
      publishOnImport: input.publishOnImport,
      createdBy: requester.id,
    });
  }

  /** 命令行导入：保存为系统私有文件并建立任务，由调用方直接执行 */
  async createFromContent(content: Buffer, fileName: string, publishOnImport: boolean): Promise<ImportJob> {
    const file = await this.fileStorageService.store(content, fileName, FilePurpose.IMPORT, null);
    return this.importJobRepository.create({ fileId: file.id, publishOnImport, createdBy: null });
  }

  findManyWithPaginationAndCount(options: {
    status?: ImportJobStatus;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: ImportJob[]; total: number }> {
    return this.importJobRepository.findManyWithPaginationAndCount(options);
  }

  async findById(id: ImportJob['id']): Promise<ImportJob> {
    const job = await this.importJobRepository.findById(id);
    if (!job) {
      throw importJobNotFound();
    }
    return job;
  }

  async getErrorReport(id: ImportJob['id']): Promise<ImportErrorReport> {
    const job = await this.findById(id);
    const file = job.errorReportFileId ? await this.filesService.findById(job.errorReportFileId) : null;
    if (!file) {
      throw new NotFoundException({ error: 'importErrorReportNotFound' });
    }
    return {
      fileName: ERROR_REPORT_FILE_NAME,
      mimeType: file.mimeType ?? 'application/octet-stream',
      content: await this.fileStorageService.read(file),
    };
  }

  /** 执行待处理的任务；任务已被其他执行者领取时返回 null */
  async execute(id: ImportJob['id']): Promise<ImportExecution | null> {
    const job = await this.importJobRepository.findById(id);
    if (!job || !(await this.importJobRepository.start(id))) {
      return null;
    }

    try {
      const file = await this.filesService.findById(job.fileId);
      if (!file) {
        throw new ImportPackageError('fileNotFound');
      }
      const maxSizes = this.configService.getOrThrow('file.maxSizes', { infer: true });
      const pkg = await readImportPackage(await this.fileStorageService.read(file), {
        ...IMPORT_PACKAGE_LIMITS,
        maxEntryBytes: Math.max(maxSizes[FilePurpose.IMPORT], maxSizes[FilePurpose.IMAGE], maxSizes[FilePurpose.AUDIO]),
      });
      let reported = 0;
      const outcome = await this.contentImporter.run(
        pkg,
        { publish: job.publishOnImport },
        async (progress: ImportProgress) => {
          const processed = progress.succeeded + progress.failed + progress.skipped;
          if (processed === 0 || processed - reported >= IMPORT_PROGRESS_INTERVAL) {
            reported = processed;
            await this.importJobRepository.updateProgress(id, progress);
          }
        },
      );
      const report =
        outcome.errors.length > 0
          ? await this.fileStorageService.store(
              await buildErrorReport(outcome.errors, (reason) => this.describe(reason)),
              ERROR_REPORT_FILE_NAME,
              FilePurpose.IMPORT,
              job.createdBy,
            )
          : null;
      const finished = await this.importJobRepository.finish(id, {
        status: ImportJobStatus.DONE,
        total: outcome.total,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        skipped: outcome.skipped,
        errorReportFileId: report?.id ?? null,
        failureReason: null,
      });
      return { job: finished, errors: outcome.errors };
    } catch (error) {
      const reason = error instanceof ImportPackageError ? error.reason : 'importFailed';
      this.logger.error(
        `Import job ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      let finished: ImportJob;
      try {
        finished = await this.importJobRepository.finish(id, {
          status: ImportJobStatus.FAILED,
          errorReportFileId: null,
          failureReason: reason,
        });
      } catch (finishError) {
        this.logger.error(`Failed to mark import job ${id} as failed: ${String(finishError)}`);
        finished = Object.assign(new ImportJob(), job, { status: ImportJobStatus.FAILED, failureReason: reason });
      }
      await this.raiseFailure(id, reason);
      return { job: finished, errors: [] };
    }
  }

  /** 执行或排队超时的任务置为失败并告警，不重新执行 */
  async failStaleJobs(now = new Date()): Promise<number> {
    const jobs = await this.importJobRepository.failStale(
      new Date(now.getTime() - IMPORT_STALE_TIMEOUTS.runningMs),
      new Date(now.getTime() - IMPORT_STALE_TIMEOUTS.pendingMs),
      IMPORT_INTERRUPTED_REASON,
    );
    for (const job of jobs) {
      await this.raiseFailure(job.id, IMPORT_INTERRUPTED_REASON);
    }
    return jobs.length;
  }

  describe(reason: string): string {
    const translated = this.i18n?.t(`common.${reason}`, { lang: REPORT_LANGUAGE, defaultValue: '' });
    return typeof translated === 'string' && translated && translated !== `common.${reason}` ? translated : reason;
  }

  private async raiseFailure(id: ImportJob['id'], reason: string): Promise<void> {
    try {
      await this.alertReporter?.raise(
        IMPORT_FAILED_ALERT,
        AlertLevel.WARN,
        `导入任务 ${id} 失败：${this.describe(reason)}`,
        { importJobId: id, reason },
        `${IMPORT_FAILED_ALERT}:${id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to raise alert for import job ${id}: ${String(error)}`);
    }
  }

  private async canPublish(requester: ImportRequester): Promise<boolean> {
    return (
      requester.roleId !== null &&
      (await this.permissionsService.hasPermission(requester.roleId, Permission.CONTENT_REVIEW))
    );
  }
}
