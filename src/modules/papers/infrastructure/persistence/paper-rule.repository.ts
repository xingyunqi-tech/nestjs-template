import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { PaperRule } from '../../domain/paper-rule';
import { PaperRuleFilterOptions } from '../../dto/query-admin-paper-rule.dto';

export type CreatePaperRuleData = Omit<PaperRule, 'id' | 'createdAt' | 'updatedAt'>;

export type PaperRuleChanges = Partial<
  Pick<PaperRule, 'name' | 'durationMin' | 'multiScoringRule' | 'items' | 'status'>
>;

export abstract class PaperRuleRepository {
  abstract create(data: CreatePaperRuleData): Promise<PaperRule>;

  abstract findById(id: PaperRule['id']): Promise<NullableType<PaperRule>>;

  abstract findManyWithPaginationAndCount(options: {
    filterOptions?: PaperRuleFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: PaperRule[]; total: number }>;

  /** 按名称排序 */
  abstract findPublishedBySubject(subjectId: PaperRule['subjectId']): Promise<PaperRule[]>;

  abstract update(id: PaperRule['id'], changes: PaperRuleChanges): Promise<NullableType<PaperRule>>;

  /** 返回是否删除 */
  /** 仅删除草稿，返回是否删除 */
  abstract removeDraft(id: PaperRule['id']): Promise<boolean>;
}
