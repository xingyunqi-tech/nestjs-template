import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { ContentStatus } from '../../../exams/domain/content-status';
import { Paper } from '../../domain/paper';
import { PaperQuestion } from '../../domain/paper-question';
import { PaperType } from '../../domain/paper-type';
import { PaperFilterOptions } from '../../dto/query-admin-paper.dto';

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

export abstract class PaperRepository {
  abstract create(data: CreatePaperData): Promise<Paper>;

  abstract findById(id: Paper['id']): Promise<NullableType<Paper>>;

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

  /** 仅删除草稿，返回是否删除 */
  abstract removeDraft(id: Paper['id']): Promise<boolean>;
}
