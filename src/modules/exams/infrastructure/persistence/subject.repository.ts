import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { ContentStatus } from '../../domain/content-status';
import { Subject } from '../../domain/subject';
import { SubjectFilterOptions } from '../../dto/query-admin-subject.dto';

export type CreateSubjectData = Omit<Subject, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateSubjectData = Partial<Pick<Subject, 'name' | 'sort' | 'hasSubjective'>>;

export abstract class SubjectRepository {
  abstract create(data: CreateSubjectData): Promise<Subject>;

  abstract findById(id: Subject['id']): Promise<NullableType<Subject>>;

  abstract findManyWithPaginationAndCount(options: {
    filterOptions?: SubjectFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Subject[]; total: number }>;

  abstract findManyByExamIdAndStatus(examId: Subject['examId'], status: ContentStatus): Promise<Subject[]>;

  abstract countByExamId(examId: Subject['examId']): Promise<number>;

  abstract update(id: Subject['id'], payload: UpdateSubjectData): Promise<NullableType<Subject>>;

  /** 仅当当前状态属于 from 时更新，返回是否更新 */
  abstract transitionStatus(id: Subject['id'], from: ContentStatus[], to: ContentStatus): Promise<boolean>;

  /** 仅删除无知识点的草稿科目，返回是否删除 */
  abstract removeDraftWithoutKnowledgePoints(id: Subject['id']): Promise<boolean>;
}
