import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PaperEntity } from '../entities/paper.entity';
import { PaperQuestionEntity } from '../entities/paper-question.entity';
import { PaperMapper } from '../mappers/paper.mapper';
import { PaperQuestionMapper } from '../mappers/paper-question.mapper';
import {
  CreatePaperData,
  GenerateQuota,
  PaperCatalogOptions,
  PaperChanges,
  PaperContent,
  PaperQuestionData,
  PaperRepository,
} from '../../paper.repository';
import { Paper } from '../../../../domain/paper';
import { PaperQuestion } from '../../../../domain/paper-question';
import { PaperType } from '../../../../domain/paper-type';
import { PaperFilterOptions } from '../../../../dto/query-admin-paper.dto';
import { ContentStatus } from '../../../../../exams/domain/content-status';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const UPDATABLE_COLUMNS = ['title', 'type', 'year', 'durationMin', 'multiScoringRule', 'isFree'] as const;

@Injectable()
export class PaperRelationalRepository implements PaperRepository {
  constructor(
    @InjectRepository(PaperEntity)
    private readonly paperRepository: Repository<PaperEntity>,
    @InjectRepository(PaperQuestionEntity)
    private readonly paperQuestionRepository: Repository<PaperQuestionEntity>,
  ) {}

  async create(data: CreatePaperData): Promise<Paper> {
    const entity = await this.paperRepository.save(this.paperRepository.create(PaperMapper.toPersistence(data)));
    return PaperMapper.toDomain(entity, 0);
  }

  async findById(id: Paper['id']): Promise<NullableType<Paper>> {
    const entity = await this.paperRepository.findOne({ where: { id } });
    if (!entity) {
      return null;
    }
    const [paper] = await this.withQuestionCounts(this.paperRepository.manager, [entity]);
    return paper;
  }

  async findByIds(ids: Paper['id'][]): Promise<Paper[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.paperRepository.find({ where: { id: In(ids) } });
    return this.withQuestionCounts(this.paperRepository.manager, entities);
  }

  findManyWithPaginationAndCount({
    filterOptions,
    paginationOptions,
  }: {
    filterOptions?: PaperFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Paper[]; total: number }> {
    const query = this.paperRepository.createQueryBuilder('p');
    if (filterOptions?.subjectId) {
      query.andWhere('"p"."subjectId" = :subjectId', { subjectId: filterOptions.subjectId });
    }
    if (filterOptions?.type) {
      query.andWhere('"p"."type" = :type', { type: filterOptions.type });
    }
    if (filterOptions?.status) {
      query.andWhere('"p"."status" = :status', { status: filterOptions.status });
    }
    if (filterOptions?.keyword) {
      query.andWhere('LOWER("p"."title") LIKE LOWER(:keyword)', {
        keyword: `%${escapeLike(filterOptions.keyword)}%`,
      });
    }
    query.orderBy('p.createdAt', 'DESC');
    return this.paginate(query, paginationOptions);
  }

  findCatalog(
    { subjectId, type, viewerUserId }: PaperCatalogOptions,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Paper[]; total: number }> {
    const query = this.paperRepository
      .createQueryBuilder('p')
      .where('"p"."subjectId" = :subjectId', { subjectId })
      .andWhere('"p"."status" = :published', { published: ContentStatus.PUBLISHED })
      .andWhere('("p"."type" <> :generated OR "p"."ownerUserId" = :viewerUserId)', {
        generated: PaperType.GENERATED,
        viewerUserId,
      });
    if (type) {
      query.andWhere('"p"."type" = :type', { type });
    }
    query.orderBy('p.year', 'DESC', 'NULLS LAST').addOrderBy('p.createdAt', 'DESC');
    return this.paginate(query, paginationOptions);
  }

  async update(id: Paper['id'], changes: PaperChanges): Promise<NullableType<Paper>> {
    const values: QueryDeepPartialEntity<PaperEntity> = Object.fromEntries(
      UPDATABLE_COLUMNS.filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]]),
    );
    if (Object.keys(values).length > 0) {
      await this.paperRepository.update({ id }, values);
    }
    return this.findById(id);
  }

  async transitionStatus(id: Paper['id'], from: ContentStatus[], to: ContentStatus): Promise<boolean> {
    const result = await this.paperRepository.update({ id, status: In(from) }, { status: to });
    return (result.affected ?? 0) > 0;
  }

  async findQuestions(paperId: Paper['id']): Promise<PaperQuestion[]> {
    const entities = await this.paperQuestionRepository.find({ where: { paperId }, order: { sort: 'ASC' } });
    return entities.map((entity) => PaperQuestionMapper.toDomain(entity));
  }

  replaceQuestions(paperId: Paper['id'], content: PaperContent, questions: PaperQuestionData[]): Promise<boolean> {
    return this.paperRepository.manager.transaction(async (manager) => {
      const paper = await manager.findOne(PaperEntity, {
        where: { id: paperId },
        lock: { mode: 'pessimistic_write' },
      });
      if (paper?.status !== ContentStatus.DRAFT) {
        return false;
      }
      await manager.delete(PaperQuestionEntity, { paperId });
      await this.insertQuestions(
        manager,
        questions.map((question) => ({ ...question, paperId })),
      );
      await manager.update(
        PaperEntity,
        { id: paperId },
        {
          sections: content.sections,
          totalScore: content.totalScore.toFixed(2),
          objectiveScore: content.objectiveScore.toFixed(2),
        },
      );
      return true;
    });
  }

  saveWithQuestions(
    id: Paper['id'] | null,
    data: CreatePaperData,
    questions: PaperQuestionData[],
  ): Promise<NullableType<Paper['id']>> {
    return this.paperRepository.manager.transaction(async (manager) => {
      const values = PaperMapper.toPersistence(data);
      let paperId: string;
      if (id) {
        const paper = await manager.findOne(PaperEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (paper?.status !== ContentStatus.DRAFT) {
          return null;
        }
        await manager.update(PaperEntity, { id }, values);
        await manager.delete(PaperQuestionEntity, { paperId: id });
        paperId = id;
      } else {
        paperId = (await manager.save(manager.create(PaperEntity, values))).id;
      }
      await this.insertQuestions(
        manager,
        questions.map((question) => ({ ...question, paperId })),
      );
      return paperId;
    });
  }

  copy(sourceId: Paper['id'], derive: (source: Paper) => CreatePaperData): Promise<NullableType<Paper>> {
    return this.paperRepository.manager.transaction(async (manager) => {
      const source = await manager.findOne(PaperEntity, {
        where: { id: sourceId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!source) {
        return null;
      }
      const questions = await manager.find(PaperQuestionEntity, { where: { paperId: sourceId } });
      const data = derive(PaperMapper.toDomain(source, questions.length));
      const entity = await manager.save(manager.create(PaperEntity, PaperMapper.toPersistence(data)));
      await this.insertQuestions(
        manager,
        questions.map((question) => ({ ...PaperQuestionMapper.toDomain(question), paperId: entity.id })),
      );
      return PaperMapper.toDomain(entity, questions.length);
    });
  }

  createGenerated(
    data: CreatePaperData,
    questions: PaperQuestionData[],
    quota: GenerateQuota,
  ): Promise<NullableType<Paper['id']>> {
    return this.paperRepository.manager.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('paper_generate'), $1)`, [data.ownerUserId]);
      const [{ count }]: { count: number }[] = await manager.query(
        `SELECT COUNT(*)::int AS "count" FROM "paper"
         WHERE "ownerUserId" = $1 AND "type" = $2
           AND "createdAt" >= ($3::timestamptz AT TIME ZONE current_setting('TimeZone'))`,
        [data.ownerUserId, PaperType.GENERATED, quota.since],
      );
      if (count >= quota.limit) {
        return null;
      }
      const paperId = (await manager.save(manager.create(PaperEntity, PaperMapper.toPersistence(data)))).id;
      await this.insertQuestions(
        manager,
        questions.map((question) => ({ ...question, paperId })),
      );
      return paperId;
    });
  }

  async removeStaleGenerated(before: Date, batchSize: number): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.paperRepository
        .createQueryBuilder()
        .delete()
        .from(PaperEntity)
        .where(
          `id IN (
            SELECT p."id" FROM "paper" AS p
            WHERE p."type" = :generated
              AND p."createdAt" < (CAST(:before AS timestamptz) AT TIME ZONE current_setting('TimeZone'))
              AND NOT EXISTS (SELECT 1 FROM "practice_session" AS s WHERE s."paperId" = p."id")
            LIMIT :batchSize FOR UPDATE SKIP LOCKED
          )`,
          { generated: PaperType.GENERATED, before, batchSize },
        )
        .execute();
      const affected = result.affected ?? 0;
      total += affected;
      if (affected < batchSize) {
        return total;
      }
    }
  }

  async removeGeneratedByOwner(ownerUserId: number): Promise<void> {
    await this.paperRepository.delete({ ownerUserId, type: PaperType.GENERATED });
  }

  async removeDraft(id: Paper['id']): Promise<boolean> {
    const result = await this.paperRepository.delete({ id, status: ContentStatus.DRAFT });
    return (result.affected ?? 0) > 0;
  }

  async raiseQuestionVersion(handle: TransactionHandle, questionId: string, version: number): Promise<number> {
    const result = await entityManagerOf(handle)
      .createQueryBuilder()
      .update(PaperQuestionEntity)
      .set({ questionVersion: version })
      .where('"questionId" = :questionId AND "questionVersion" < :version', { questionId, version })
      .execute();
    return result.affected ?? 0;
  }

  private async insertQuestions(manager: EntityManager, questions: PaperQuestion[]): Promise<void> {
    if (questions.length > 0) {
      await manager.insert(
        PaperQuestionEntity,
        questions.map((question) => PaperQuestionMapper.toPersistence(question)),
      );
    }
  }

  private async paginate(
    query: SelectQueryBuilder<PaperEntity>,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Paper[]; total: number }> {
    const [entities, total] = await query
      .addOrderBy('p.id', 'ASC')
      .skip((paginationOptions.page - 1) * paginationOptions.limit)
      .take(paginationOptions.limit)
      .getManyAndCount();
    return { data: await this.withQuestionCounts(this.paperRepository.manager, entities), total };
  }

  private async withQuestionCounts(manager: EntityManager, entities: PaperEntity[]): Promise<Paper[]> {
    if (entities.length === 0) {
      return [];
    }
    const rows: { paperId: string; count: number }[] = await manager
      .createQueryBuilder(PaperQuestionEntity, 'pq')
      .select('pq.paperId', 'paperId')
      .addSelect('COUNT(*)::int', 'count')
      .where('pq.paperId IN (:...ids)', { ids: entities.map((entity) => entity.id) })
      .groupBy('pq.paperId')
      .getRawMany();
    const counts = new Map(rows.map((row) => [row.paperId, row.count]));
    return entities.map((entity) => PaperMapper.toDomain(entity, counts.get(entity.id) ?? 0));
  }
}
