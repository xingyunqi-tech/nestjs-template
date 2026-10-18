import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { Question, QuestionSummary } from '../../domain/question';
import { QuestionVersion } from '../../domain/question-version';
import { QuestionDrawCandidate, QuestionDrawCriteria } from '../../domain/question-unit';
import { QuestionFilterOptions } from '../../dto/query-admin-question.dto';

export type CreateQuestionData = Omit<
  Question,
  'id' | 'currentVersion' | 'knowledgePointIds' | 'statAnswered' | 'statCorrect' | 'createdAt' | 'updatedAt'
>;

export type QuestionChanges = Partial<
  Pick<
    Question,
    | 'type'
    | 'stem'
    | 'options'
    | 'answer'
    | 'analysis'
    | 'difficulty'
    | 'material'
    | 'audioFileId'
    | 'source'
    | 'sourceNote'
    | 'isFree'
    | 'sort'
    | 'contentHash'
    | 'currentVersion'
    | 'status'
  >
>;

export type CreateQuestionVersionData = Omit<QuestionVersion, 'id' | 'createdAt' | 'updatedAt'>;

export type QuestionVersionKey = Pick<QuestionVersion, 'questionId' | 'version'>;

export type TaggableKnowledgePoint = { id: string; subjectId: string; isLeaf: boolean };

export type KnowledgePointCountDelta = { knowledgePointId: string; delta: number };

/** 在持有科目锁的事务内执行的题目写操作 */
export interface QuestionTransaction {
  /** 按 id 顺序加行锁 */
  findForUpdate(ids: Question['id'][]): Promise<Question[]>;

  /** 按 sort 返回并锁定材料的小题 */
  findChildrenForUpdate(parentIds: Question['id'][]): Promise<Question[]>;

  /** 按 id 顺序锁定知识点行 */
  findKnowledgePointsForUpdate(ids: string[]): Promise<TaggableKnowledgePoint[]>;

  findIdByContentHash(
    subjectId: Question['subjectId'],
    contentHash: Question['contentHash'],
    excludeIds: Question['id'][],
  ): Promise<NullableType<Question['id']>>;

  maxChildSort(parentId: Question['id']): Promise<NullableType<number>>;

  insert(data: CreateQuestionData): Promise<Question>;

  update(ids: Question['id'][], changes: QuestionChanges): Promise<void>;

  replaceKnowledgePoints(questionId: Question['id'], knowledgePointIds: string[]): Promise<void>;

  insertVersion(data: CreateQuestionVersionData): Promise<void>;

  adjustQuestionCounts(deltas: KnowledgePointCountDelta[]): Promise<void>;

  /** 删除题目及其小题 */
  remove(ids: Question['id'][]): Promise<void>;
}

export abstract class QuestionRepository {
  abstract findById(id: Question['id']): Promise<NullableType<Question>>;

  abstract findByIds(ids: Question['id'][]): Promise<Question[]>;

  abstract findSummariesByIds(ids: Question['id'][]): Promise<QuestionSummary[]>;

  abstract findChildren(parentId: Question['id']): Promise<Question[]>;

  /** 按材料、sort 排序 */
  abstract findChildrenByParentIds(parentIds: Question['id'][]): Promise<Question[]>;

  /** 随机取已发布的独立题与材料，size 为已发布小题数（独立题为 1） */
  abstract findDrawCandidates(criteria: QuestionDrawCriteria, limit: number): Promise<QuestionDrawCandidate[]>;

  abstract findManyWithPaginationAndCount(options: {
    filterOptions?: QuestionFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Question[]; total: number }>;

  abstract findVersions(questionId: Question['id']): Promise<QuestionVersion[]>;

  abstract findVersionsByKeys(keys: QuestionVersionKey[]): Promise<QuestionVersion[]>;

  /** 按顺序取得各科目锁后在同一事务内执行；与知识点树变更共用科目锁 */
  abstract transaction<T>(
    subjectIds: Question['subjectId'][],
    work: (tx: QuestionTransaction) => Promise<T>,
  ): Promise<T>;
}
