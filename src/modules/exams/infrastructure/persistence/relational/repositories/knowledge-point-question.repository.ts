import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { KnowledgePointEntity } from '../entities/knowledge-point.entity';
import { KnowledgePointQuestionRepository } from '../../knowledge-point-question.repository';
import { KnowledgePoint } from '../../../../domain/knowledge-point';

const PUBLISHED_COUNTS_SQL = `SELECT links."knowledgePointId", COUNT(*)::int AS "count"
  FROM (SELECT NULL::uuid AS "knowledgePointId" WHERE false) AS links
  GROUP BY links."knowledgePointId"`;

/** 空实现：任何知识点都没有关联题目 */
@Injectable()
export class EmptyKnowledgePointQuestionRepository implements KnowledgePointQuestionRepository {
  constructor(
    @InjectRepository(KnowledgePointEntity)
    private readonly knowledgePointRepository: Repository<KnowledgePointEntity>,
  ) {}

  countLinked(_knowledgePointIds: KnowledgePoint['id'][], _manager: EntityManager): Promise<number> {
    return Promise.resolve(0);
  }

  migrate(_sourceId: KnowledgePoint['id'], _targetId: KnowledgePoint['id'], _manager: EntityManager): Promise<number> {
    return Promise.resolve(0);
  }

  async recountQuestionCounts(subjectId?: KnowledgePoint['subjectId']): Promise<number> {
    const [, affected]: [unknown, number] = await this.knowledgePointRepository.query(
      `UPDATE "knowledge_point" AS kp SET "questionCount" = COALESCE(c."count", 0)
       FROM "knowledge_point" AS k
       LEFT JOIN (${PUBLISHED_COUNTS_SQL}) AS c ON c."knowledgePointId" = k."id"
       WHERE kp."id" = k."id"
         AND ($1::uuid IS NULL OR k."subjectId" = $1)
         AND kp."questionCount" <> COALESCE(c."count", 0)`,
      [subjectId ?? null],
    );
    return affected;
  }
}
