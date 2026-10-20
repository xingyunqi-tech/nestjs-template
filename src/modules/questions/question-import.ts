import { Question } from './domain/question';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

export type QuestionImportFields = Omit<CreateQuestionDto, 'subjectId' | 'parentId'>;

/** ref 为调用方用于定位出错行的标识；id 为已有题目时更新该题，未提供的字段保持原值 */
export type QuestionImportItem =
  { ref: string; id: null; fields: QuestionImportFields } | { ref: string; id: string; fields: UpdateQuestionDto };

export interface QuestionImportUnit {
  subjectId: string;
  root: QuestionImportItem;
  /** 材料的小题，按顺序 */
  children: QuestionImportItem[];
  publish: boolean;
  /** 写入新建题目的 createdBy；publish 时同时写入 submittedBy、reviewedBy */
  operatorId: number | null;
}

export interface QuestionImportResult {
  rootId: Question['id'];
  ids: Record<string, Question['id']>;
}

export class QuestionImportItemError extends Error {
  constructor(
    readonly ref: string,
    cause: unknown,
  ) {
    super(`Question import item ${ref} failed`, { cause });
  }
}
