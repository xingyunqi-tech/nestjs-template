import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { KnowledgePointEntity } from '../entities/knowledge-point.entity';
import { KnowledgePointMapper } from '../mappers/knowledge-point.mapper';
import {
  CreateKnowledgePointData,
  KnowledgePointRepository,
  MigrateQuestionsResult,
  QuestionCountDelta,
  UpdateKnowledgePointData,
} from '../../knowledge-point.repository';
import { KnowledgePointQuestionRepository } from '../../knowledge-point-question.repository';
import { KnowledgePoint } from '../../../../domain/knowledge-point';
import {
  checkCanAddChild,
  checkCanMigrate,
  checkCanMove,
  checkCanRemove,
  KnowledgePointChangeResult,
  KnowledgePointViolation,
  knowledgePointPath,
} from '../../../../domain/knowledge-point-rules';
import { NullableType } from '../../../../../../common/types/nullable.type';

const UPDATABLE_COLUMNS = ['name', 'sort'] as const;

function violated<T>(violation: KnowledgePointViolation): KnowledgePointChangeResult<T> {
  return { ok: false, violation };
}

@Injectable()
export class KnowledgePointRelationalRepository implements KnowledgePointRepository {
  constructor(
    @InjectRepository(KnowledgePointEntity)
    private readonly knowledgePointRepository: Repository<KnowledgePointEntity>,
    private readonly knowledgePointQuestionRepository: KnowledgePointQuestionRepository,
  ) {}

  async findById(id: KnowledgePoint['id']): Promise<NullableType<KnowledgePoint>> {
    const entity = await this.knowledgePointRepository.findOne({ where: { id } });
    return entity ? KnowledgePointMapper.toDomain(entity) : null;
  }

  async findManyBySubjectId(subjectId: KnowledgePoint['subjectId']): Promise<KnowledgePoint[]> {
    const entities = await this.knowledgePointRepository.find({
      where: { subjectId },
      order: { level: 'ASC', sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => KnowledgePointMapper.toDomain(entity));
  }

  countBySubjectId(subjectId: KnowledgePoint['subjectId']): Promise<number> {
    return this.knowledgePointRepository.count({ where: { subjectId } });
  }

  async create(data: CreateKnowledgePointData): Promise<KnowledgePointChangeResult> {
    return this.knowledgePointRepository.manager.transaction(async (manager) => {
      await this.lockSubjectTree(manager, data.subjectId);

      let parent: KnowledgePointEntity | null = null;
      if (data.parentId) {
        parent = await this.findForUpdate(manager, data.parentId);
        if (parent?.subjectId !== data.subjectId) {
          return violated(KnowledgePointViolation.INVALID_PARENT);
        }
        const violation = checkCanAddChild(parent, await this.countLinked(manager, parent.id));
        if (violation) {
          return violated(violation);
        }
      }

      const id = randomUUID();
      const entity = await manager.save(
        manager.create(
          KnowledgePointEntity,
          KnowledgePointMapper.toPersistence({
            id,
            subjectId: data.subjectId,
            parentId: parent?.id ?? null,
            name: data.name,
            sort: data.sort,
            level: (parent?.level ?? 0) + 1,
            path: knowledgePointPath(parent?.path ?? null, id),
            isLeaf: true,
            questionCount: 0,
          }),
        ),
      );
      if (parent?.isLeaf) {
        await manager.update(KnowledgePointEntity, { id: parent.id }, { isLeaf: false });
      }
      return { ok: true, value: KnowledgePointMapper.toDomain(entity) };
    });
  }

  async update(id: KnowledgePoint['id'], payload: UpdateKnowledgePointData): Promise<NullableType<KnowledgePoint>> {
    const changes: QueryDeepPartialEntity<KnowledgePointEntity> = Object.fromEntries(
      UPDATABLE_COLUMNS.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]),
    );
    if (Object.keys(changes).length > 0) {
      await this.knowledgePointRepository.update({ id }, changes);
    }
    return this.findById(id);
  }

  async move(
    id: KnowledgePoint['id'],
    parentId: KnowledgePoint['parentId'],
    sort?: KnowledgePoint['sort'],
  ): Promise<KnowledgePointChangeResult> {
    return this.knowledgePointRepository.manager.transaction(async (manager) => {
      const node = await this.lockNodeTree(manager, id);
      if (!node) {
        return violated(KnowledgePointViolation.NOT_FOUND);
      }

      if (parentId === node.parentId) {
        if (sort !== undefined) {
          await manager.update(KnowledgePointEntity, { id }, { sort });
        }
        return { ok: true, value: KnowledgePointMapper.toDomain(await this.findOneOrFail(manager, id)) };
      }

      const newParent = parentId ? await this.findForUpdate(manager, parentId) : null;
      if (parentId && !newParent) {
        return violated(KnowledgePointViolation.INVALID_PARENT);
      }

      const [{ maxLevel }]: { maxLevel: number }[] = await manager.query(
        `SELECT MAX("level")::int AS "maxLevel" FROM "knowledge_point" WHERE "subjectId" = $1 AND "path" LIKE $2`,
        [node.subjectId, `${node.path}%`],
      );
      const newParentLinked = newParent ? await this.countLinked(manager, newParent.id) : 0;
      const violation = checkCanMove(node, maxLevel, newParent, newParentLinked);
      if (violation) {
        return violated(violation);
      }

      const newPath = knowledgePointPath(newParent?.path ?? null, node.id);
      const levelDelta = (newParent?.level ?? 0) + 1 - node.level;
      await manager.query(
        `UPDATE "knowledge_point"
         SET "path" = $1 || substr("path", $2), "level" = "level" + $3, "updatedAt" = now()
         WHERE "subjectId" = $4 AND "path" LIKE $5`,
        [newPath, node.path.length + 1, levelDelta, node.subjectId, `${node.path}%`],
      );
      await manager.update(
        KnowledgePointEntity,
        { id },
        { parentId: newParent?.id ?? null, ...(sort !== undefined && { sort }) },
      );
      if (newParent?.isLeaf) {
        await manager.update(KnowledgePointEntity, { id: newParent.id }, { isLeaf: false });
      }
      if (node.parentId) {
        await this.refreshIsLeaf(manager, node.parentId);
      }
      return { ok: true, value: KnowledgePointMapper.toDomain(await this.findOneOrFail(manager, id)) };
    });
  }

  async remove(id: KnowledgePoint['id']): Promise<KnowledgePointChangeResult<void>> {
    return this.knowledgePointRepository.manager.transaction(async (manager) => {
      const node = await this.lockNodeTree(manager, id);
      if (!node) {
        return violated(KnowledgePointViolation.NOT_FOUND);
      }
      const hasChildren = await manager.exists(KnowledgePointEntity, { where: { parentId: id } });
      const violation = checkCanRemove(
        { isLeaf: !hasChildren, questionCount: node.questionCount },
        await this.countLinked(manager, id),
      );
      if (violation) {
        return violated(violation);
      }

      await manager.delete(KnowledgePointEntity, { id });
      if (node.parentId) {
        await this.refreshIsLeaf(manager, node.parentId);
      }
      return { ok: true, value: undefined };
    });
  }

  async migrateQuestions(
    sourceId: KnowledgePoint['id'],
    targetId: KnowledgePoint['id'],
  ): Promise<KnowledgePointChangeResult<MigrateQuestionsResult>> {
    return this.knowledgePointRepository.manager.transaction(async (manager) => {
      const source = await this.lockNodeTree(manager, sourceId);
      if (!source) {
        return violated(KnowledgePointViolation.NOT_FOUND);
      }
      const target = await manager.findOne(KnowledgePointEntity, { where: { id: targetId } });
      const violation = checkCanMigrate(source, target);
      if (violation) {
        return violated(violation);
      }
      await this.findForUpdate(manager, targetId);

      const migrated = await this.knowledgePointQuestionRepository.migrate(sourceId, targetId, manager);
      return {
        ok: true,
        value: {
          migrated,
          source: KnowledgePointMapper.toDomain(await this.findOneOrFail(manager, sourceId)),
          target: KnowledgePointMapper.toDomain(await this.findOneOrFail(manager, targetId)),
        },
      };
    });
  }

  async adjustQuestionCounts(deltas: QuestionCountDelta[]): Promise<void> {
    const merged = new Map<string, number>();
    for (const { knowledgePointId, delta } of deltas) {
      merged.set(knowledgePointId, (merged.get(knowledgePointId) ?? 0) + delta);
    }
    const entries = [...merged].filter(([, delta]) => delta !== 0);
    if (entries.length === 0) {
      return;
    }
    await this.knowledgePointRepository.manager.transaction(async (manager) => {
      const ids = entries.map(([id]) => id);
      await manager.query(`SELECT "id" FROM "knowledge_point" WHERE "id" = ANY($1) ORDER BY "id" FOR UPDATE`, [ids]);
      await manager.query(
        `UPDATE "knowledge_point" AS kp SET "questionCount" = kp."questionCount" + d."delta"
         FROM unnest($1::uuid[], $2::int[]) AS d("id", "delta")
         WHERE kp."id" = d."id"`,
        [ids, entries.map(([, delta]) => delta)],
      );
    });
  }

  private countLinked(manager: EntityManager, id: string): Promise<number> {
    return this.knowledgePointQuestionRepository.countLinked([id], manager);
  }

  private async lockSubjectTree(manager: EntityManager, subjectId: string): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('knowledge_point'), hashtext($1))`, [subjectId]);
  }

  private async lockNodeTree(manager: EntityManager, id: string): Promise<KnowledgePointEntity | null> {
    const node = await manager.findOne(KnowledgePointEntity, { where: { id } });
    if (!node) {
      return null;
    }
    await this.lockSubjectTree(manager, node.subjectId);
    return this.findForUpdate(manager, id);
  }

  private findForUpdate(manager: EntityManager, id: string): Promise<KnowledgePointEntity | null> {
    return manager.findOne(KnowledgePointEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  private findOneOrFail(manager: EntityManager, id: string): Promise<KnowledgePointEntity> {
    return manager.findOneOrFail(KnowledgePointEntity, { where: { id } });
  }

  private async refreshIsLeaf(manager: EntityManager, id: string): Promise<void> {
    await manager.query(
      `UPDATE "knowledge_point" SET "isLeaf" = NOT EXISTS (SELECT 1 FROM "knowledge_point" WHERE "parentId" = $1)
       WHERE "id" = $1`,
      [id],
    );
  }
}
