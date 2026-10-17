import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ExamEntity } from '../entities/exam.entity';
import { ExamMapper } from '../mappers/exam.mapper';
import { CreateExamData, ExamRepository, UpdateExamData } from '../../exam.repository';
import { Exam } from '../../../../domain/exam';
import { ContentStatus } from '../../../../domain/content-status';
import { ExamFilterOptions } from '../../../../dto/query-admin-exam.dto';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { escapeLike } from './escape-like';

const UPDATABLE_COLUMNS = ['name', 'category', 'icon', 'description', 'sort'] as const;

@Injectable()
export class ExamRelationalRepository implements ExamRepository {
  constructor(
    @InjectRepository(ExamEntity)
    private readonly examRepository: Repository<ExamEntity>,
  ) {}

  async create(data: CreateExamData): Promise<Exam> {
    const entity = await this.examRepository.save(this.examRepository.create(ExamMapper.toPersistence(data)));
    return ExamMapper.toDomain(entity);
  }

  async findById(id: Exam['id']): Promise<NullableType<Exam>> {
    const entity = await this.examRepository.findOne({ where: { id } });
    return entity ? ExamMapper.toDomain(entity) : null;
  }

  async findManyWithPaginationAndCount({
    filterOptions,
    paginationOptions,
  }: {
    filterOptions?: ExamFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Exam[]; total: number }> {
    const where: FindOptionsWhere<ExamEntity> = {};
    if (filterOptions?.keyword) {
      where.name = ILike(`%${escapeLike(filterOptions.keyword)}%`);
    }
    if (filterOptions?.status) {
      where.status = filterOptions.status;
    }
    if (filterOptions?.category) {
      where.category = filterOptions.category;
    }

    const [entities, total] = await this.examRepository.findAndCount({
      where,
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      order: { sort: 'ASC', createdAt: 'DESC', id: 'ASC' },
    });
    return { data: entities.map((entity) => ExamMapper.toDomain(entity)), total };
  }

  async findManyByStatus(status: ContentStatus): Promise<Exam[]> {
    const entities = await this.examRepository.find({
      where: { status },
      order: { sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => ExamMapper.toDomain(entity));
  }

  async update(id: Exam['id'], payload: UpdateExamData): Promise<NullableType<Exam>> {
    const changes: QueryDeepPartialEntity<ExamEntity> = Object.fromEntries(
      UPDATABLE_COLUMNS.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]),
    );
    if (Object.keys(changes).length > 0) {
      await this.examRepository.update({ id }, changes);
    }
    return this.findById(id);
  }

  async transitionStatus(id: Exam['id'], from: ContentStatus[], to: ContentStatus): Promise<boolean> {
    const result = await this.examRepository.update({ id, status: In(from) }, { status: to });
    return (result.affected ?? 0) > 0;
  }

  async removeDraftWithoutSubjects(id: Exam['id']): Promise<boolean> {
    const result = await this.examRepository
      .createQueryBuilder()
      .delete()
      .from(ExamEntity)
      .where('"id" = :id AND "status" = :status', { id, status: ContentStatus.DRAFT })
      .andWhere('NOT EXISTS (SELECT 1 FROM "subject" WHERE "examId" = :id)')
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
