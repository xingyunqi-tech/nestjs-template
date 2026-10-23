import type { Mocked } from 'vitest';
import { HttpStatus, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import ExcelJS from 'exceljs';
import { ImportsService } from './imports.service';
import { ImportJobRepository } from './infrastructure/persistence/import-job.repository';
import { ContentImporter } from './content-importer';
import { ImportJob } from './domain/import-job';
import { ImportJobStatus } from './domain/import-job-status';
import { ImportOutcome, emptyImportSummary } from './domain/import-outcome';
import { ImportRowError } from './domain/import-row-error';
import { buildErrorReport } from './error-report';
import { FilesService } from '../files/files.service';
import { FileStorageService } from '../files/file-storage.service';
import { FilePurpose } from '../files/domain/file-purpose';
import { FileType } from '../files/domain/file';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';
import { AllConfigType } from '../../config/config.type';

const JOB_ID = 'job-1';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const job = (overrides: Partial<ImportJob> = {}): ImportJob =>
  Object.assign(new ImportJob(), {
    id: JOB_ID,
    fileId: 'file-1',
    status: ImportJobStatus.PENDING,
    publishOnImport: false,
    total: 0,
    succeeded: 0,
    failed: 0,
    errorReportFileId: null,
    failureReason: null,
    createdBy: 3,
    ...overrides,
  });

const file = (overrides: Partial<FileType> = {}): FileType =>
  Object.assign(new FileType(), { id: 'file-1', path: '/a.zip', mimeType: 'application/zip', ...overrides });

describe('ImportsService', () => {
  let repository: Mocked<ImportJobRepository>;
  let contentImporter: Mocked<Pick<ContentImporter, 'run' | 'precheck'>>;
  let filesService: Mocked<Pick<FilesService, 'findAccessible' | 'findById'>>;
  let fileStorageService: Mocked<Pick<FileStorageService, 'store' | 'read'>>;
  let alertReporter: Mocked<AlertReporter>;
  let service: ImportsService;

  beforeEach(() => {
    repository = {
      create: vi.fn((data) => Promise.resolve(job(data))),
      findById: vi.fn().mockResolvedValue(job()),
      findManyWithPaginationAndCount: vi.fn(),
      start: vi.fn().mockResolvedValue(true),
      updateProgress: vi.fn(),
      failStale: vi.fn().mockResolvedValue([]),
      finish: vi.fn((_id, data) => Promise.resolve(job({ ...data }))),
    };
    contentImporter = { run: vi.fn(), precheck: vi.fn() };
    filesService = { findAccessible: vi.fn().mockResolvedValue(file()), findById: vi.fn().mockResolvedValue(file()) };
    fileStorageService = {
      store: vi.fn((_content: Buffer, name: string) => Promise.resolve(file({ id: `stored-${name}` }))),
      read: vi.fn().mockResolvedValue(Buffer.from('{"questions":[]}')),
    };
    alertReporter = { raise: vi.fn() };
    const configService = {
      getOrThrow: vi.fn(() => ({
        [FilePurpose.IMPORT]: 50,
        [FilePurpose.IMAGE]: 5,
        [FilePurpose.AUDIO]: 20,
      })),
    };
    const i18n = { t: vi.fn((key: string) => (key === 'common.duplicateQuestion' ? '题目已存在' : key)) };
    service = new ImportsService(
      repository,
      contentImporter as unknown as ContentImporter,
      filesService as unknown as FilesService,
      fileStorageService as unknown as FileStorageService,
      configService as unknown as ConfigService<AllConfigType>,
      alertReporter,
      i18n as unknown as I18nService,
    );
  });

  describe('create', () => {
    const requester = { id: 3, roleId: RoleEnum.user };

    it('should store an uploaded package as a private import file of the requester', async () => {
      const created = await service.create(
        { upload: { buffer: Buffer.from('zip'), originalname: 'a.zip' }, publishOnImport: false },
        requester,
      );

      expect(fileStorageService.store).toHaveBeenCalledWith(Buffer.from('zip'), 'a.zip', FilePurpose.IMPORT, 3);
      expect(repository.create).toHaveBeenCalledWith({ fileId: 'stored-a.zip', publishOnImport: false, createdBy: 3 });
      expect(created.status).toBe(ImportJobStatus.PENDING);
    });

    it('should accept an accessible uploaded import file by id', async () => {
      await service.create({ fileId: 'file-1', publishOnImport: false }, requester);

      expect(filesService.findAccessible).toHaveBeenCalledWith('file-1', 3);
      expect(repository.create).toHaveBeenCalledWith({ fileId: 'file-1', publishOnImport: false, createdBy: 3 });
    });

    it('should reject a referenced file that is not an import package', async () => {
      filesService.findAccessible.mockResolvedValue(file({ mimeType: 'image/png' }));

      await expect(service.create({ fileId: 'file-1', publishOnImport: false }, requester)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.create({ publishOnImport: false }, requester)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should allow only admins to publish on import', async () => {
      for (const roleId of [RoleEnum.user, RoleEnum.editor, RoleEnum.reviewer, null]) {
        await expect(
          service.create({ fileId: 'file-1', publishOnImport: true }, { id: 3, roleId }),
        ).rejects.toMatchObject({ response: { error: 'importPublishForbidden' } });
      }
      expect(repository.create).not.toHaveBeenCalled();

      await service.create({ fileId: 'file-1', publishOnImport: true }, { id: 3, roleId: RoleEnum.admin });
      expect(repository.create).toHaveBeenCalledWith({ fileId: 'file-1', publishOnImport: true, createdBy: 3 });
    });
  });

  describe('execute', () => {
    const outcome = (overrides: Partial<ImportOutcome> = {}): ImportOutcome => ({
      total: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
      errors: [{ sheet: 'questions', row: 3, field: '', reason: 'duplicateQuestion', detail: 'duplicateQuestionId=q' }],
      ...overrides,
    });

    it('should skip a job that another worker already started', async () => {
      repository.start.mockResolvedValue(false);

      await expect(service.execute(JOB_ID)).resolves.toBeNull();
      expect(contentImporter.run).not.toHaveBeenCalled();
    });

    it('should finish with counts and a private error report', async () => {
      repository.findById.mockResolvedValue(job({ publishOnImport: true }));
      contentImporter.run.mockResolvedValue(outcome());

      const execution = await service.execute(JOB_ID);

      expect(contentImporter.run).toHaveBeenCalledWith(
        expect.objectContaining({ assets: new Map() }),
        { publish: true, operatorId: 3 },
        expect.any(Function),
      );
      const [content, name, purpose, owner] = fileStorageService.store.mock.calls[0];
      expect([name, purpose, owner]).toEqual(['import-errors.xlsx', FilePurpose.IMPORT, 3]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content as unknown as ExcelJS.Buffer);
      expect(workbook.getWorksheet('errors')!.getRow(2).values).toEqual([
        undefined,
        'questions',
        3,
        '',
        'duplicateQuestion',
        '题目已存在',
        'duplicateQuestionId=q',
      ]);
      expect(repository.finish).toHaveBeenCalledWith(JOB_ID, {
        status: ImportJobStatus.DONE,
        total: 2,
        succeeded: 1,
        failed: 1,
        skipped: 0,
        errorReportFileId: 'stored-import-errors.xlsx',
        failureReason: null,
      });
      expect(execution?.errors).toHaveLength(1);
      expect(alertReporter.raise).not.toHaveBeenCalled();
    });

    it('should not create a report when every unit succeeds', async () => {
      contentImporter.run.mockResolvedValue(outcome({ succeeded: 2, failed: 0, errors: [] }));

      await service.execute(JOB_ID);

      expect(fileStorageService.store).not.toHaveBeenCalled();
      expect(repository.finish).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ errorReportFileId: null }));
    });

    it('should save progress at the start and then every 20 units', async () => {
      contentImporter.run.mockImplementation(async (_pkg, _options, onProgress) => {
        for (let processed = 0; processed <= 45; processed++) {
          await onProgress!({ total: 45, succeeded: processed, failed: 0, skipped: 0 });
        }
        return outcome({ errors: [] });
      });

      await service.execute(JOB_ID);

      expect(repository.updateProgress.mock.calls.map(([, progress]) => progress.succeeded)).toEqual([0, 20, 40]);
    });

    it('should fail the job and raise an alert when the package cannot be read', async () => {
      fileStorageService.read.mockResolvedValue(Buffer.from('not a package'));

      const execution = await service.execute(JOB_ID);

      expect(repository.finish).toHaveBeenCalledWith(JOB_ID, {
        status: ImportJobStatus.FAILED,
        errorReportFileId: null,
        failureReason: 'importInvalidPackage',
      });
      expect(alertReporter.raise).toHaveBeenCalledWith(
        'importFailed',
        AlertLevel.WARN,
        expect.stringContaining(JOB_ID),
        { importJobId: JOB_ID, reason: 'importInvalidPackage' },
        `importFailed:${JOB_ID}`,
      );
      expect(execution?.job.status).toBe(ImportJobStatus.FAILED);
    });

    it('should fail the job on unexpected errors while importing', async () => {
      contentImporter.run.mockRejectedValue(new Error('db down'));

      await service.execute(JOB_ID);

      expect(repository.finish).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({ status: ImportJobStatus.FAILED, failureReason: 'importFailed' }),
      );
      expect(alertReporter.raise).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure handling', () => {
    it('should still report the failure when marking the job as failed fails', async () => {
      contentImporter.run.mockRejectedValue(new Error('db down'));
      repository.finish.mockRejectedValue(new Error('db down'));

      const execution = await service.execute(JOB_ID);

      expect(execution?.job).toMatchObject({
        id: JOB_ID,
        status: ImportJobStatus.FAILED,
        failureReason: 'importFailed',
      });
      expect(alertReporter.raise).toHaveBeenCalledTimes(1);
    });

    it('should fail stale jobs with thresholds and alert for each', async () => {
      repository.failStale.mockResolvedValue([job({ id: 'a' }), job({ id: 'b' })]);
      const now = new Date('2026-10-17T10:00:00Z');

      await expect(service.failStaleJobs(now)).resolves.toBe(2);

      expect(repository.failStale).toHaveBeenCalledWith(
        new Date('2026-10-17T09:30:00Z'),
        new Date('2026-10-17T09:50:00Z'),
        'importInterrupted',
      );
      expect(alertReporter.raise.mock.calls.map((call) => call[4])).toEqual(['importFailed:a', 'importFailed:b']);
    });
  });

  describe('getErrorReport', () => {
    it('should return the stored report content', async () => {
      repository.findById.mockResolvedValue(job({ errorReportFileId: 'report' }));
      filesService.findById.mockResolvedValue(file({ id: 'report', mimeType: XLSX }));
      fileStorageService.read.mockResolvedValue(Buffer.from('xlsx'));

      await expect(service.getErrorReport(JOB_ID)).resolves.toEqual({
        fileName: 'import-errors.xlsx',
        mimeType: XLSX,
        content: Buffer.from('xlsx'),
      });
    });

    it('should throw 404 for unknown jobs or jobs without a report', async () => {
      await expect(service.getErrorReport(JOB_ID)).rejects.toBeInstanceOf(NotFoundException);
      repository.findById.mockResolvedValue(null);
      await expect(service.getErrorReport(JOB_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('precheck', () => {
    const admin = { id: 3, roleId: RoleEnum.admin };
    const rowError = (row: number): ImportRowError => ({
      sheet: 'questions',
      row,
      field: '',
      reason: 'duplicateQuestion',
    });
    const jsonPackage = (questions: number): Buffer =>
      Buffer.from(JSON.stringify({ questions: Array.from({ length: questions }, () => ({ stem: 'x' })) }));

    it('should check an uploaded package without storing it or creating a job', async () => {
      const summary = emptyImportSummary();
      summary.created.questions = 1;
      summary.skipped.materials = 2;
      contentImporter.precheck.mockResolvedValue({
        total: 4,
        succeeded: 1,
        failed: 1,
        skipped: 2,
        errors: [rowError(3)],
        summary,
      });

      const result = await service.precheck(
        { upload: { buffer: jsonPackage(1), originalname: 'content.json' }, publishOnImport: true },
        admin,
      );

      expect(result).toEqual({
        wouldCreate: { knowledgePoints: 0, materials: 0, questions: 1, papers: 0 },
        wouldUpdate: { knowledgePoints: 0, materials: 0, questions: 0, papers: 0 },
        wouldSkip: { knowledgePoints: 0, materials: 2, questions: 0, papers: 0 },
        errors: [{ ...rowError(3), message: '题目已存在' }],
        truncated: false,
      });
      expect(contentImporter.precheck).toHaveBeenCalledWith(expect.objectContaining({ assets: new Map() }), {
        publish: true,
        operatorId: 3,
      });
      expect(fileStorageService.store).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should read a referenced import file', async () => {
      contentImporter.precheck.mockResolvedValue({
        total: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        summary: emptyImportSummary(),
      });

      await service.precheck({ fileId: 'file-1', publishOnImport: false }, admin);

      expect(filesService.findAccessible).toHaveBeenCalledWith('file-1', 3);
      expect(fileStorageService.read).toHaveBeenCalledWith(file());
    });

    it('should return at most 500 errors and mark the result as truncated', async () => {
      contentImporter.precheck.mockResolvedValue({
        total: 501,
        succeeded: 0,
        failed: 501,
        skipped: 0,
        errors: Array.from({ length: 501 }, (_, index) => rowError(index + 2)),
        summary: emptyImportSummary(),
      });

      const result = await service.precheck(
        { upload: { buffer: jsonPackage(1), originalname: 'content.json' }, publishOnImport: false },
        admin,
      );

      expect(result.errors).toHaveLength(500);
      expect(result.errors[499].row).toBe(501);
      expect(result.truncated).toBe(true);
    });

    it('should reject packages with more than 2000 units with 413', async () => {
      const upload = { buffer: jsonPackage(2001), originalname: 'content.json' };

      await expect(service.precheck({ upload, publishOnImport: false }, admin)).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        response: { error: 'importPrecheckTooLarge' },
      });
      expect(contentImporter.precheck).not.toHaveBeenCalled();
    });

    it('should reject unreadable packages and non-admin publishing', async () => {
      const upload = { buffer: Buffer.from('not a package'), originalname: 'a.zip' };

      await expect(service.precheck({ upload, publishOnImport: false }, admin)).rejects.toMatchObject({
        constructor: UnprocessableEntityException,
        response: { error: 'importInvalidPackage' },
      });
      await expect(
        service.precheck({ upload, publishOnImport: true }, { id: 3, roleId: RoleEnum.editor }),
      ).rejects.toMatchObject({ response: { error: 'importPublishForbidden' } });
    });
  });

  describe('findErrors', () => {
    const errors: ImportRowError[] = [
      { sheet: 'questions', row: 2, field: 'answer', reason: 'duplicateQuestion' },
      { sheet: 'papers', row: 2, field: '', reason: 'paperFrozen', detail: 'id=p' },
      { sheet: 'questions', row: 3, field: 'stem', reason: 'importFieldRequired' },
      { sheet: 'questions', row: 4, field: 'type', reason: 'importFieldRequired' },
    ];

    beforeEach(async () => {
      repository.findById.mockResolvedValue(job({ errorReportFileId: 'report' }));
      filesService.findById.mockResolvedValue(file({ id: 'report', mimeType: XLSX }));
      fileStorageService.read.mockResolvedValue(await buildErrorReport(errors, (reason) => `说明 ${reason}`));
    });

    it('should page the rows of the error report with messages', async () => {
      const page = await service.findErrors(JOB_ID, { page: 1, limit: 2 });

      expect(page).toEqual({
        total: 4,
        data: [
          { ...errors[0], message: '说明 duplicateQuestion' },
          { ...errors[1], message: '说明 paperFrozen' },
        ],
      });
    });

    it('should filter by sheet before paging', async () => {
      const page = await service.findErrors(JOB_ID, { sheet: 'questions', page: 2, limit: 2 });

      expect(page).toEqual({ total: 3, data: [{ ...errors[3], message: '说明 importFieldRequired' }] });
    });

    it('should return an empty list for a job without errors and 404 for unknown jobs', async () => {
      repository.findById.mockResolvedValue(job({ errorReportFileId: null }));
      await expect(service.findErrors(JOB_ID, { page: 1, limit: 20 })).resolves.toEqual({ data: [], total: 0 });

      repository.findById.mockResolvedValue(null);
      await expect(service.findErrors(JOB_ID, { page: 1, limit: 20 })).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
