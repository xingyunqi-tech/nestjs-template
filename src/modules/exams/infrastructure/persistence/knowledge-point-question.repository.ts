import type { EntityManager } from 'typeorm';
import { KnowledgePoint } from '../../domain/knowledge-point';

/** 知识点与题目的关联 */
export abstract class KnowledgePointQuestionRepository {
  /** 须在持有科目锁的事务内调用；题目侧打标签与发布须先取同一科目锁再锁 knowledge_point 行 */
  abstract countLinked(knowledgePointIds: KnowledgePoint['id'][], manager: EntityManager): Promise<number>;

  /** 把 source 的题目关联改为 target 并同步两者的已发布题目数，返回迁移的题目数 */
  abstract migrate(
    sourceId: KnowledgePoint['id'],
    targetId: KnowledgePoint['id'],
    manager: EntityManager,
  ): Promise<number>;

  /** 按题目关联重算已发布题目数，可限定科目，返回变更的知识点数 */
  abstract recountQuestionCounts(subjectId?: KnowledgePoint['subjectId']): Promise<number>;
}
