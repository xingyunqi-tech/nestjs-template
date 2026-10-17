import { ImportJob } from '../../../../domain/import-job';
import { ImportJobEntity } from '../entities/import-job.entity';
import { ImportJobStatus } from '../../../../domain/import-job-status';

export class ImportJobMapper {
  static toDomain(raw: ImportJobEntity): ImportJob {
    const domain = new ImportJob();
    domain.id = raw.id;
    domain.fileId = raw.fileId;
    domain.status = raw.status;
    domain.publishOnImport = raw.publishOnImport;
    domain.total = raw.total;
    domain.succeeded = raw.succeeded;
    domain.failed = raw.failed;
    domain.skipped = raw.skipped;
    domain.errorReportFileId = raw.errorReportFileId;
    domain.failureReason = raw.failureReason;
    domain.createdBy = raw.createdBy;
    domain.startedAt = raw.startedAt;
    domain.finishedAt = raw.finishedAt;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: Pick<ImportJob, 'fileId' | 'publishOnImport' | 'createdBy'>): ImportJobEntity {
    const entity = new ImportJobEntity();
    entity.fileId = domain.fileId;
    entity.publishOnImport = domain.publishOnImport;
    entity.createdBy = domain.createdBy;
    entity.status = ImportJobStatus.PENDING;
    return entity;
  }
}
