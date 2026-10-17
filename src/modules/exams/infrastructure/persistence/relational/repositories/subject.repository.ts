import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SubjectEntity } from '../entities/subject.entity';
import { SubjectMapper } from '../mappers/subject.mapper';
import { CreateSubjectData, SubjectRepository, UpdateSubjectData } from '../../subject.repository';
import { Subject } from '../../../../domain/subject';
import { ContentStatus } from '../../../../domain/content-status';
import { SubjectFilterOptions } from '../../../../dto/query-admin-subject.dto';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { escapeLike } from './escape-like';

const UPDATABLE_COLUMNS = ['name', 'sort', 'hasSubjective'] as const;

@Injectable()
export class SubjectRelationalRepository implements SubjectRepository {
  constructor(
    @InjectRepository(SubjectEntity)
    private readonly subjectRepository: Repository<SubjectEntity>,
  ) {}

  async create(data: CreateSubjectData): Promise<Subject> {
    const entity = await this.subjectRepository.save(this.subjectRepository.create(SubjectMapper.toPersistence(data)));
    return SubjectMapper.toDomain(entity);
  }

  async findById(id: Subject['id']): Promise<NullableType<Subject>> {
    const entity = await this.subjectRepository.findOne({ where: { id } });
    return entity ? SubjectMapper.toDomain(entity) : null;
  }

  async findManyByExamNameAndName(examName: string, name: Subject['name']): Promise<Subject[]> {
    const entities = await this.subjectRepository
      .createQueryBuilder('s')
      .innerJoin('exam', 'e', '"e"."id" = "s"."examId"')
      .where('"e"."name" = :examName', { examName })
      .andWhere('"s"."name" = :name', { name })
      .orderBy('s.id', 'ASC')
      .getMany();
    return entities.map((entity) => SubjectMapper.toDomain(entity));
  }

  async findManyWithPaginationAndCount({
    filterOptions,
    paginationOptions,
  }: {
    filterOptions?: SubjectFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Subject[]; total: number }> {
    const where: FindOptionsWhere<SubjectEntity> = {};
    if (filterOptions?.keyword) {
      where.name = ILike(`%${escapeLike(filterOptions.keyword)}%`);
    }
    if (filterOptions?.status) {
      where.status = filterOptions.status;
    }
    if (filterOptions?.examId) {
      where.examId = filterOptions.examId;
    }

    const [entities, total] = await this.subjectRepository.findAndCount({
      where,
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      order: { sort: 'ASC', createdAt: 'DESC', id: 'ASC' },
    });
    return { data: entities.map((entity) => SubjectMapper.toDomain(entity)), total };
  }

  async findManyByExamIdAndStatus(examId: Subject['examId'], status: ContentStatus): Promise<Subject[]> {
    const entities = await this.subjectRepository.find({
      where: { examId, status },
      order: { sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => SubjectMapper.toDomain(entity));
  }

  async findAllPublished(): Promise<Subject[]> {
    const entities = await this.subjectRepository
      .createQueryBuilder('s')
      .innerJoin('s.exam', 'e')
      .where('s.status = :published AND e.status = :published', { published: ContentStatus.PUBLISHED })
      .orderBy('s.createdAt', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .getMany();
    return entities.map((entity) => SubjectMapper.toDomain(entity));
  }

  countByExamId(examId: Subject['examId']): Promise<number> {
    return this.subjectRepository.count({ where: { examId } });
  }

  async update(id: Subject['id'], payload: UpdateSubjectData): Promise<NullableType<Subject>> {
    const changes: QueryDeepPartialEntity<SubjectEntity> = Object.fromEntries(
      UPDATABLE_COLUMNS.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]),
    );
    if (Object.keys(changes).length > 0) {
      await this.subjectRepository.update({ id }, changes);
    }
    return this.findById(id);
  }

  async transitionStatus(id: Subject['id'], from: ContentStatus[], to: ContentStatus): Promise<boolean> {
    const result = await this.subjectRepository.update({ id, status: In(from) }, { status: to });
    return (result.affected ?? 0) > 0;
  }

  async removeDraftWithoutKnowledgePoints(id: Subject['id']): Promise<boolean> {
    const result = await this.subjectRepository
      .createQueryBuilder()
      .delete()
      .from(SubjectEntity)
      .where('"id" = :id AND "status" = :status', { id, status: ContentStatus.DRAFT })
      .andWhere('NOT EXISTS (SELECT 1 FROM "knowledge_point" WHERE "subjectId" = :id)')
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
