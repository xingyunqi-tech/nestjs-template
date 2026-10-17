import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { ContentStatus } from '../../domain/content-status';
import { Exam } from '../../domain/exam';
import { ExamFilterOptions } from '../../dto/query-admin-exam.dto';

export type CreateExamData = Omit<Exam, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateExamData = Partial<Pick<Exam, 'name' | 'category' | 'icon' | 'description' | 'sort'>>;

export abstract class ExamRepository {
  abstract create(data: CreateExamData): Promise<Exam>;

  abstract findById(id: Exam['id']): Promise<NullableType<Exam>>;

  abstract findManyWithPaginationAndCount(options: {
    filterOptions?: ExamFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Exam[]; total: number }>;

  abstract findManyByStatus(status: ContentStatus): Promise<Exam[]>;

  abstract update(id: Exam['id'], payload: UpdateExamData): Promise<NullableType<Exam>>;

  /** 仅当当前状态属于 from 时更新，返回是否更新 */
  abstract transitionStatus(id: Exam['id'], from: ContentStatus[], to: ContentStatus): Promise<boolean>;

  /** 仅删除无科目的草稿考试，返回是否删除 */
  abstract removeDraftWithoutSubjects(id: Exam['id']): Promise<boolean>;
}
