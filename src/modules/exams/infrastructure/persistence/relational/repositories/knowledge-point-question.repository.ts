import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { KnowledgePointEntity } from '../entities/knowledge-point.entity';
import { KnowledgePointMapper } from '../mappers/knowledge-point.mapper';
import { KnowledgePointQuestionRepository } from '../../knowledge-point-question.repository';
import { KnowledgePoint } from '../../../../domain/knowledge-point';
import { lockSubjectTree } from './subject-tree-lock';

const PUBLISHED_COUNTS_SQL = `SELECT links."knowledgePointId", COUNT(*)::int AS "count"
  FROM "question_knowledge_point" AS links
  INNER JOIN "question" AS q ON q."id" = links."questionId"
  WHERE q."status" = 'PUBLISHED'
  GROUP BY links."knowledgePointId"`;

@Injectable()
export class KnowledgePointQuestionRelationalRepository implements KnowledgePointQuestionRepository {
  constructor(
    @InjectRepository(KnowledgePointEntity)
    private readonly knowledgePointRepository: Repository<KnowledgePointEntity>,
  ) {}

  async countLinked(knowledgePointIds: KnowledgePoint['id'][], manager: EntityManager): Promise<number> {
    if (knowledgePointIds.length === 0) {
      return 0;
    }
    const [{ count }]: { count: number }[] = await manager.query(
      `SELECT COUNT(DISTINCT "questionId")::int AS "count" FROM "question_knowledge_point"
       WHERE "knowledgePointId" = ANY($1)`,
      [knowledgePointIds],
    );
    return count;
  }

  async migrate(
    sourceId: KnowledgePoint['id'],
    targetId: KnowledgePoint['id'],
    manager: EntityManager,
  ): Promise<number> {
    const [result]: { migrated: number; removedPublished: number; addedPublished: number }[] = await manager.query(
      `WITH moved AS (
         DELETE FROM "question_knowledge_point" WHERE "knowledgePointId" = $1 RETURNING "questionId"
       ), inserted AS (
         INSERT INTO "question_knowledge_point" ("questionId", "knowledgePointId")
         SELECT "questionId", $2 FROM moved
         ON CONFLICT DO NOTHING
         RETURNING "questionId"
       )
       SELECT
         (SELECT COUNT(*) FROM moved)::int AS "migrated",
         (SELECT COUNT(*) FROM moved INNER JOIN "question" AS q ON q."id" = moved."questionId"
           WHERE q."status" = 'PUBLISHED')::int AS "removedPublished",
         (SELECT COUNT(*) FROM inserted INNER JOIN "question" AS q ON q."id" = inserted."questionId"
           WHERE q."status" = 'PUBLISHED')::int AS "addedPublished"`,
      [sourceId, targetId],
    );
    await manager.query(
      `UPDATE "knowledge_point" AS kp SET "questionCount" = kp."questionCount" + d."delta"
       FROM unnest($1::uuid[], $2::int[]) AS d("id", "delta")
       WHERE kp."id" = d."id" AND d."delta" <> 0`,
      [
        [sourceId, targetId],
        [-result.removedPublished, result.addedPublished],
      ],
    );
    return result.migrated;
  }

  async recountQuestionCounts(subjectId?: KnowledgePoint['subjectId']): Promise<number> {
    const subjectIds = subjectId
      ? [subjectId]
      : (
          await this.knowledgePointRepository
            .createQueryBuilder('kp')
            .select('kp.subjectId', 'subjectId')
            .distinct(true)
            .orderBy('kp.subjectId')
            .getRawMany<{ subjectId: string }>()
        ).map((row) => row.subjectId);

    let changed = 0;
    for (const id of subjectIds) {
      changed += await this.knowledgePointRepository.manager.transaction(async (manager) => {
        await lockSubjectTree(manager, id);
        const [, affected]: [unknown, number] = await manager.query(
          `UPDATE "knowledge_point" AS kp SET "questionCount" = COALESCE(c."count", 0)
           FROM "knowledge_point" AS k
           LEFT JOIN (${PUBLISHED_COUNTS_SQL}) AS c ON c."knowledgePointId" = k."id"
           WHERE kp."id" = k."id"
             AND k."subjectId" = $1
             AND kp."questionCount" <> COALESCE(c."count", 0)`,
          [id],
        );
        return affected;
      });
    }
    return changed;
  }

  lockSubject(subjectId: KnowledgePoint['subjectId'], manager: EntityManager): Promise<void> {
    return lockSubjectTree(manager, subjectId);
  }

  async lockKnowledgePoints(ids: KnowledgePoint['id'][], manager: EntityManager): Promise<KnowledgePoint[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await manager.find(KnowledgePointEntity, {
      where: { id: In(ids) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    return entities.map((entity) => KnowledgePointMapper.toDomain(entity));
  }
}
