import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { ContentStatus } from '../../../exams/domain/content-status';
import { Paper } from '../../domain/paper';
import { PaperQuestion } from '../../domain/paper-question';
import { PaperType } from '../../domain/paper-type';
import { PaperFilterOptions } from '../../dto/query-admin-paper.dto';
import { TransactionHandle } from '../../../../common/database/transaction-handle';

export type CreatePaperData = Omit<Paper, 'id' | 'attemptCount' | 'questionCount' | 'createdAt' | 'updatedAt'>;

export type PaperChanges = Partial<
  Pick<Paper, 'title' | 'type' | 'year' | 'durationMin' | 'multiScoringRule' | 'isFree'>
>;

export type PaperQuestionData = Omit<PaperQuestion, 'paperId'>;

export type PaperContent = Pick<Paper, 'sections' | 'totalScore' | 'objectiveScore'>;

export interface PaperCatalogOptions {
  subjectId: Paper['subjectId'];
  type?: PaperType;
  viewerUserId: number | null;
}

export interface GenerateQuota {
  since: Date;
  limit: number;
}

export abstract class PaperRepository {
  abstract create(data: CreatePaperData): Promise<Paper>;

  abstract findById(id: Paper['id']): Promise<NullableType<Paper>>;

  abstract findByIds(ids: Paper['id'][]): Promise<Paper[]>;

  abstract findManyWithPaginationAndCount(options: {
    filterOptions?: PaperFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Paper[]; total: number }>;

  /** 已发布试卷，GENERATED 只含查看者本人的 */
  abstract findCatalog(
    options: PaperCatalogOptions,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Paper[]; total: number }>;

  abstract update(id: Paper['id'], changes: PaperChanges): Promise<NullableType<Paper>>;

  /** 仅当当前状态属于 from 时更新，返回是否更新 */
  abstract transitionStatus(id: Paper['id'], from: ContentStatus[], to: ContentStatus): Promise<boolean>;

  abstract findQuestions(paperId: Paper['id']): Promise<PaperQuestion[]>;

  /** 锁定试卷，仅草稿时整体替换题目与分区，返回是否替换 */
  abstract replaceQuestions(
    paperId: Paper['id'],
    content: PaperContent,
    questions: PaperQuestionData[],
  ): Promise<boolean>;

  /** 新建试卷，或锁定并更新仍为草稿的 id 对应试卷，同时整体替换题目；试卷已非草稿时返回 null */
  abstract saveWithQuestions(
    id: Paper['id'] | null,
    data: CreatePaperData,
    questions: PaperQuestionData[],
  ): Promise<NullableType<Paper['id']>>;

  abstract copy(sourceId: Paper['id'], derive: (source: Paper) => CreatePaperData): Promise<NullableType<Paper>>;

  /** 按所属用户互斥：since 之后该用户生成的试卷数已达 limit 时不创建并返回 null */
  abstract createGenerated(
    data: CreatePaperData,
    questions: PaperQuestionData[],
    quota: GenerateQuota,
  ): Promise<NullableType<Paper['id']>>;

  /** 删除 before 之前创建且从未开考的按规则生成的试卷，返回删除数 */
  abstract removeStaleGenerated(before: Date, batchSize: number): Promise<number>;

  /** 仅删除草稿，返回是否删除 */
  abstract removeDraft(id: Paper['id']): Promise<boolean>;

  /** 删除该用户的个人生成试卷；仍有练习会话引用时因外键约束失败 */
  abstract removeGeneratedByOwner(ownerUserId: number): Promise<void>;

  /** 事务内把引用该题低于 version 的试卷题目版本更新为 version，返回更新行数 */
  abstract raiseQuestionVersion(handle: TransactionHandle, questionId: string, version: number): Promise<number>;
}
