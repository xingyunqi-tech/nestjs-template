import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { QuestionNote } from '../../domain/question-note';

export interface QuestionNoteFilter {
  userId: number;
  subjectId?: string;
  questionId?: string;
}

export abstract class QuestionNoteRepository {
  abstract upsert(data: Pick<QuestionNote, 'userId' | 'questionId' | 'subjectId' | 'content'>): Promise<QuestionNote>;

  abstract findOne(userId: number, questionId: string): Promise<NullableType<QuestionNote>>;

  /** 返回是否删除 */
  abstract remove(userId: number, questionId: string): Promise<boolean>;

  /** 按更新时间倒序 */
  abstract findManyWithPaginationAndCount(
    filter: QuestionNoteFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: QuestionNote[]; total: number }>;

  /** questionIds 中该用户写过笔记的题目 */
  abstract findQuestionIdsWithNote(userId: number, questionIds: string[]): Promise<string[]>;
}
