import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ImportJobEntity } from '../entities/import-job.entity';
import { ImportJobMapper } from '../mappers/import-job.mapper';
import { CreateImportJobData, FinishImportJobData, ImportJobRepository } from '../../import-job.repository';
import { ImportJob } from '../../../../domain/import-job';
import { ImportJobStatus } from '../../../../domain/import-job-status';
import { ImportProgress } from '../../../../domain/import-outcome';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

@Injectable()
export class ImportJobRelationalRepository implements ImportJobRepository {
  constructor(
    @InjectRepository(ImportJobEntity)
    private readonly importJobRepository: Repository<ImportJobEntity>,
  ) {}

  async create(data: CreateImportJobData): Promise<ImportJob> {
    const entity = await this.importJobRepository.save(ImportJobMapper.toPersistence(data));
    return ImportJobMapper.toDomain(await this.importJobRepository.findOneOrFail({ where: { id: entity.id } }));
  }

  async findById(id: ImportJob['id']): Promise<NullableType<ImportJob>> {
    const entity = await this.importJobRepository.findOne({ where: { id } });
    return entity ? ImportJobMapper.toDomain(entity) : null;
  }

  async findManyWithPaginationAndCount({
    status,
    paginationOptions,
  }: {
    status?: ImportJobStatus;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: ImportJob[]; total: number }> {
    const [entities, total] = await this.importJobRepository.findAndCount({
      where: status ? { status } : {},
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return { data: entities.map((entity) => ImportJobMapper.toDomain(entity)), total };
  }

  async start(id: ImportJob['id']): Promise<boolean> {
    const result = await this.importJobRepository.update(
      { id, status: ImportJobStatus.PENDING },
      { status: ImportJobStatus.RUNNING, startedAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  async updateProgress(id: ImportJob['id'], progress: ImportProgress): Promise<void> {
    await this.importJobRepository.update({ id }, progress);
  }

  async failStale(runningBefore: Date, pendingBefore: Date, failureReason: string): Promise<ImportJob[]> {
    const candidates = await this.importJobRepository.find({
      select: { id: true },
      where: [
        { status: ImportJobStatus.RUNNING, startedAt: LessThan(runningBefore) },
        { status: ImportJobStatus.PENDING, createdAt: LessThan(pendingBefore) },
      ],
    });
    const failed: ImportJob[] = [];
    for (const { id } of candidates) {
      const result = await this.importJobRepository
        .createQueryBuilder()
        .update(ImportJobEntity)
        .set({ status: ImportJobStatus.FAILED, failureReason, finishedAt: new Date() })
        .where('"id" = :id', { id })
        .andWhere(
          '(("status" = :running AND "startedAt" < :runningBefore) OR ("status" = :pending AND "createdAt" < :pendingBefore))',
          { running: ImportJobStatus.RUNNING, pending: ImportJobStatus.PENDING, runningBefore, pendingBefore },
        )
        .execute();
      if ((result.affected ?? 0) > 0) {
        failed.push(ImportJobMapper.toDomain(await this.importJobRepository.findOneOrFail({ where: { id } })));
      }
    }
    return failed;
  }

  async finish(id: ImportJob['id'], data: FinishImportJobData): Promise<ImportJob> {
    await this.importJobRepository.update({ id }, { ...data, finishedAt: new Date() });
    return ImportJobMapper.toDomain(await this.importJobRepository.findOneOrFail({ where: { id } }));
  }
}
