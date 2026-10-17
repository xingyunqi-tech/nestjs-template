import { NullableType } from '../../../../common/types/nullable.type';
import { KnowledgePoint } from '../../domain/knowledge-point';
import { KnowledgePointChangeResult } from '../../domain/knowledge-point-rules';

export type CreateKnowledgePointData = Pick<KnowledgePoint, 'subjectId' | 'parentId' | 'name' | 'sort'>;
export type UpdateKnowledgePointData = Partial<Pick<KnowledgePoint, 'name' | 'sort'>>;
export type MigrateQuestionsResult = { migrated: number; source: KnowledgePoint; target: KnowledgePoint };
export type QuestionCountDelta = { knowledgePointId: KnowledgePoint['id']; delta: number };

/** 结构变更与题目迁移在事务内按科目串行执行并重新校验树规则 */
export abstract class KnowledgePointRepository {
  abstract findById(id: KnowledgePoint['id']): Promise<NullableType<KnowledgePoint>>;

  abstract findManyBySubjectId(subjectId: KnowledgePoint['subjectId']): Promise<KnowledgePoint[]>;

  abstract countBySubjectId(subjectId: KnowledgePoint['subjectId']): Promise<number>;

  abstract create(data: CreateKnowledgePointData): Promise<KnowledgePointChangeResult>;

  abstract update(id: KnowledgePoint['id'], payload: UpdateKnowledgePointData): Promise<NullableType<KnowledgePoint>>;

  abstract move(
    id: KnowledgePoint['id'],
    parentId: KnowledgePoint['parentId'],
    sort?: KnowledgePoint['sort'],
  ): Promise<KnowledgePointChangeResult>;

  abstract remove(id: KnowledgePoint['id']): Promise<KnowledgePointChangeResult<void>>;

  abstract migrateQuestions(
    sourceId: KnowledgePoint['id'],
    targetId: KnowledgePoint['id'],
  ): Promise<KnowledgePointChangeResult<MigrateQuestionsResult>>;

  /** 原子增减已发布题目数 */
  abstract adjustQuestionCounts(deltas: QuestionCountDelta[]): Promise<void>;
}
