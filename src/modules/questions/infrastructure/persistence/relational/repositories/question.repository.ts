import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { QuestionEntity } from '../entities/question.entity';
import { QuestionVersionEntity } from '../entities/question-version.entity';
import { QuestionKnowledgePointEntity } from '../entities/question-knowledge-point.entity';
import { QuestionMapper } from '../mappers/question.mapper';
import { QuestionVersionMapper } from '../mappers/question-version.mapper';
import {
  CreateQuestionData,
  CreateQuestionVersionData,
  KnowledgePointCountDelta,
  QuestionChanges,
  QuestionRepository,
  QuestionTransaction,
  QuestionVersionKey,
  TaggableKnowledgePoint,
} from '../../question.repository';
import { Question, QuestionSummary } from '../../../../domain/question';
import { QuestionVersion } from '../../../../domain/question-version';
import { QuestionType } from '../../../../domain/question-type';
import { QuestionStatus } from '../../../../domain/question-status';
import { QuestionDrawCandidate, QuestionDrawCriteria } from '../../../../domain/question-unit';
import { QuestionFilterOptions } from '../../../../dto/query-admin-question.dto';
import { KnowledgePointQuestionCountService } from '../../../../../exams/knowledge-point-question-count.service';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import {
  TransactionHandle,
  createTransactionHandle,
  entityManagerOf,
} from '../../../../../../common/database/transaction-handle';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function withKnowledgePoints(manager: EntityManager, entities: QuestionEntity[]): Promise<Question[]> {
  if (entities.length === 0) {
    return [];
  }
  const links = await manager.find(QuestionKnowledgePointEntity, {
    where: { questionId: In(entities.map((entity) => entity.id)) },
    order: { knowledgePointId: 'ASC' },
  });
  const byQuestion = new Map<string, string[]>();
  for (const link of links) {
    byQuestion.set(link.questionId, [...(byQuestion.get(link.questionId) ?? []), link.knowledgePointId]);
  }
  return entities.map((entity) => QuestionMapper.toDomain(entity, byQuestion.get(entity.id) ?? []));
}

class RelationalQuestionTransaction implements QuestionTransaction {
  readonly handle: TransactionHandle;

  constructor(
    private readonly manager: EntityManager,
    private readonly knowledgePointQuestionCountService: KnowledgePointQuestionCountService,
  ) {
    this.handle = createTransactionHandle(manager);
  }

  async findForUpdate(ids: Question['id'][]): Promise<Question[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.manager.find(QuestionEntity, {
      where: { id: In(ids) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    return withKnowledgePoints(this.manager, entities);
  }

  async findChildrenForUpdate(parentIds: Question['id'][]): Promise<Question[]> {
    if (parentIds.length === 0) {
      return [];
    }
    const entities = await this.manager.find(QuestionEntity, {
      where: { parentId: In(parentIds) },
      order: { parentId: 'ASC', sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    return withKnowledgePoints(this.manager, entities);
  }

  async findKnowledgePointsForUpdate(ids: string[]): Promise<TaggableKnowledgePoint[]> {
    const points = await this.knowledgePointQuestionCountService.lockKnowledgePoints(ids, this.manager);
    return points.map(({ id, subjectId, isLeaf }) => ({ id, subjectId, isLeaf }));
  }

  async findIdByContentHash(
    subjectId: Question['subjectId'],
    contentHash: Question['contentHash'],
    excludeIds: Question['id'][],
  ): Promise<NullableType<Question['id']>> {
    const entity = await this.manager.findOne(QuestionEntity, {
      select: { id: true },
      where: { subjectId, contentHash, ...(excludeIds.length > 0 && { id: Not(In(excludeIds)) }) },
    });
    return entity?.id ?? null;
  }

  async maxChildSort(parentId: Question['id']): Promise<NullableType<number>> {
    const [{ max }]: { max: number | null }[] = await this.manager.query(
      `SELECT MAX("sort")::int AS "max" FROM "question" WHERE "parentId" = $1`,
      [parentId],
    );
    return max;
  }

  async insert(data: CreateQuestionData): Promise<Question> {
    const entity = await this.manager.save(this.manager.create(QuestionEntity, QuestionMapper.toPersistence(data)));
    return QuestionMapper.toDomain(entity, []);
  }

  async update(ids: Question['id'][], changes: QuestionChanges): Promise<void> {
    if (ids.length === 0 || Object.keys(changes).length === 0) {
      return;
    }
    await this.manager.update(QuestionEntity, { id: In(ids) }, changes);
  }

  async replaceKnowledgePoints(questionId: Question['id'], knowledgePointIds: string[]): Promise<void> {
    await this.manager.delete(QuestionKnowledgePointEntity, { questionId });
    if (knowledgePointIds.length > 0) {
      await this.manager.insert(
        QuestionKnowledgePointEntity,
        knowledgePointIds.map((knowledgePointId) => ({ questionId, knowledgePointId })),
      );
    }
  }

  async insertVersion(data: CreateQuestionVersionData): Promise<void> {
    await this.manager.save(this.manager.create(QuestionVersionEntity, QuestionVersionMapper.toPersistence(data)));
  }

  adjustQuestionCounts(deltas: KnowledgePointCountDelta[]): Promise<void> {
    return this.knowledgePointQuestionCountService.adjust(deltas, this.manager);
  }

  async remove(ids: Question['id'][]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.manager.delete(QuestionEntity, { parentId: In(ids) });
    await this.manager.delete(QuestionEntity, { id: In(ids) });
  }
}

@Injectable()
export class QuestionRelationalRepository implements QuestionRepository {
  constructor(
    @InjectRepository(QuestionEntity)
    private readonly questionRepository: Repository<QuestionEntity>,
    @InjectRepository(QuestionVersionEntity)
    private readonly questionVersionRepository: Repository<QuestionVersionEntity>,
    private readonly knowledgePointQuestionCountService: KnowledgePointQuestionCountService,
  ) {}

  async findById(id: Question['id']): Promise<NullableType<Question>> {
    const [question] = await this.findByIds([id]);
    return question ?? null;
  }

  async findByIds(ids: Question['id'][]): Promise<Question[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.questionRepository.find({ where: { id: In(ids) }, order: { id: 'ASC' } });
    return withKnowledgePoints(this.questionRepository.manager, entities);
  }

  async findSummariesByIds(ids: Question['id'][]): Promise<QuestionSummary[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.questionRepository.find({
      select: { id: true, parentId: true, type: true, stem: true },
      where: { id: In(ids) },
    });
    return entities.map(({ id, parentId, type, stem }) => ({ id, parentId, type, stem }));
  }

  async findChildren(parentId: Question['id']): Promise<Question[]> {
    const entities = await this.questionRepository.find({
      where: { parentId },
      order: { sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return withKnowledgePoints(this.questionRepository.manager, entities);
  }

  async findChildrenByParentIds(parentIds: Question['id'][]): Promise<Question[]> {
    if (parentIds.length === 0) {
      return [];
    }
    const entities = await this.questionRepository.find({
      where: { parentId: In(parentIds) },
      order: { parentId: 'ASC', sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return withKnowledgePoints(this.questionRepository.manager, entities);
  }

  async findDrawCandidates(criteria: QuestionDrawCriteria, limit: number): Promise<QuestionDrawCandidate[]> {
    const query = this.questionRepository
      .createQueryBuilder('q')
      .select('q.id', 'id')
      .addSelect(
        `CASE WHEN "q"."type" = :material THEN (
          SELECT COUNT(*) FROM "question" AS c WHERE c."parentId" = "q"."id" AND c."status" = :published
        ) ELSE 1 END`,
        'size',
      )
      .where('"q"."subjectId" = :subjectId', { subjectId: criteria.subjectId })
      .andWhere('"q"."parentId" IS NULL')
      .andWhere('"q"."status" = :published')
      .setParameters({ material: QuestionType.MATERIAL, published: QuestionStatus.PUBLISHED });
    if (criteria.type) {
      query.andWhere('"q"."type" = :type', { type: criteria.type });
    }
    if (criteria.excludeRootIds?.length) {
      query.andWhere('"q"."id" <> ALL(:excludeRootIds)', { excludeRootIds: criteria.excludeRootIds });
    }

    const answerable: string[] = [];
    if (criteria.difficultyRange) {
      answerable.push('a."difficulty" BETWEEN :minDifficulty AND :maxDifficulty');
      query.setParameters({ minDifficulty: criteria.difficultyRange[0], maxDifficulty: criteria.difficultyRange[1] });
    }
    if (criteria.knowledgePointIds?.length) {
      answerable.push(`EXISTS (
        SELECT 1 FROM "question_knowledge_point" AS links
        INNER JOIN "knowledge_point" AS kp ON kp."id" = links."knowledgePointId"
        INNER JOIN "knowledge_point" AS scope ON scope."id" = ANY(:knowledgePointIds)
        WHERE links."questionId" = a."id" AND kp."path" LIKE scope."path" || '%'
      )`);
      query.setParameters({ knowledgePointIds: criteria.knowledgePointIds });
    }
    if (answerable.length > 0) {
      query.andWhere(
        `EXISTS (
          SELECT 1 FROM "question" AS a
          WHERE a."status" = :published
            AND ((a."id" = "q"."id" AND "q"."type" <> :material) OR a."parentId" = "q"."id")
            AND ${answerable.join(' AND ')}
        )`,
      );
    }

    const rows: { id: string; size: string | number }[] = await query.orderBy('RANDOM()').limit(limit).getRawMany();
    return rows.map((row) => ({ id: row.id, size: Number(row.size) })).filter((row) => row.size > 0);
  }

  async findManyWithPaginationAndCount({
    filterOptions,
    paginationOptions,
  }: {
    filterOptions?: QuestionFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Question[]; total: number }> {
    const query = this.questionRepository.createQueryBuilder('q');
    if (filterOptions?.subjectId) {
      query.andWhere('"q"."subjectId" = :subjectId', { subjectId: filterOptions.subjectId });
    }
    if (filterOptions?.type) {
      query.andWhere('"q"."type" = :type', { type: filterOptions.type });
    }
    if (filterOptions?.status) {
      query.andWhere('"q"."status" = :status', { status: filterOptions.status });
    }
    if (filterOptions?.source) {
      query.andWhere('"q"."source" = :source', { source: filterOptions.source });
    }
    if (filterOptions?.parentId) {
      query.andWhere('"q"."parentId" = :parentId', { parentId: filterOptions.parentId });
    }
    if (filterOptions?.topLevel !== undefined) {
      query.andWhere(filterOptions.topLevel ? '"q"."parentId" IS NULL' : '"q"."parentId" IS NOT NULL');
    }
    if (filterOptions?.keyword) {
      query.andWhere('(LOWER("q"."stem") LIKE LOWER(:keyword) OR LOWER("q"."material") LIKE LOWER(:keyword))', {
        keyword: `%${escapeLike(filterOptions.keyword)}%`,
      });
    }
    if (filterOptions?.knowledgePointId) {
      query.andWhere(
        `EXISTS (
          SELECT 1 FROM "question_knowledge_point" AS links
          INNER JOIN "knowledge_point" AS kp ON kp."id" = links."knowledgePointId"
          WHERE links."questionId" = "q"."id"
            AND kp."path" LIKE (SELECT "path" FROM "knowledge_point" WHERE "id" = :knowledgePointId) || '%'
        )`,
        { knowledgePointId: filterOptions.knowledgePointId },
      );
    }
    if (filterOptions?.parentId) {
      query.orderBy('q.sort', 'ASC').addOrderBy('q.createdAt', 'ASC');
    } else {
      query.orderBy('q.createdAt', 'DESC');
    }
    query
      .addOrderBy('q.id', 'ASC')
      .skip((paginationOptions.page - 1) * paginationOptions.limit)
      .take(paginationOptions.limit);

    const [entities, total] = await query.getManyAndCount();
    return { data: await withKnowledgePoints(this.questionRepository.manager, entities), total };
  }

  async findVersions(questionId: Question['id']): Promise<QuestionVersion[]> {
    const entities = await this.questionVersionRepository.find({
      where: { questionId },
      order: { version: 'DESC' },
    });
    return entities.map((entity) => QuestionVersionMapper.toDomain(entity));
  }

  async adjustStatCorrect(handle: TransactionHandle, id: Question['id'], delta: number): Promise<void> {
    if (delta === 0) {
      return;
    }
    await entityManagerOf(handle).query(
      `UPDATE "question" SET "statCorrect" = GREATEST("statCorrect" + $2, 0) WHERE "id" = $1`,
      [id, Math.trunc(delta)],
    );
  }

  async findVersionsByKeys(keys: QuestionVersionKey[]): Promise<QuestionVersion[]> {
    if (keys.length === 0) {
      return [];
    }
    const entities = await this.questionVersionRepository
      .createQueryBuilder('v')
      .where(
        '("v"."questionId", "v"."version") IN (SELECT * FROM unnest(CAST(:questionIds AS uuid[]), CAST(:versions AS int[])))',
        {
          questionIds: keys.map((key) => key.questionId),
          versions: keys.map((key) => key.version),
        },
      )
      .getMany();
    return entities.map((entity) => QuestionVersionMapper.toDomain(entity));
  }

  transaction<T>(subjectIds: Question['subjectId'][], work: (tx: QuestionTransaction) => Promise<T>): Promise<T> {
    return this.questionRepository.manager.transaction(async (manager) => {
      for (const subjectId of [...new Set(subjectIds)].sort()) {
        await this.knowledgePointQuestionCountService.lockSubject(subjectId, manager);
      }
      return work(new RelationalQuestionTransaction(manager, this.knowledgePointQuestionCountService));
    });
  }
}
