import { NullableType } from '../../../../common/types/nullable.type';
import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { WrongQuestion, WrongQuestionStatus } from '../../domain/wrong-question';

export interface WrongAnswerData {
  userId: number;
  questionId: string;
  subjectId: string;
  answer: Record<string, unknown> | null;
  wrongAt: Date;
}

export interface CorrectAnswerData {
  userId: number;
  questionId: string;
  statDate: string;
  masterThreshold: number;
}

export enum WrongBookSortField {
  LAST_WRONG_AT = 'lastWrongAt',
  FIRST_WRONG_AT = 'firstWrongAt',
  WRONG_COUNT = 'wrongCount',
}

export interface WrongBookFilter {
  userId: number;
  status: WrongQuestionStatus;
  subjectId?: string;
  /** 含子树 */
  knowledgePointId?: string;
  minWrongCount?: number;
  maxWrongCount?: number;
  lastWrongFrom?: Date;
  lastWrongTo?: Date;
  sortBy: WrongBookSortField;
  order: 'ASC' | 'DESC';
}

export interface WrongBookCounts {
  activeCount: number;
  weeklyAdded: number;
  weeklyMastered: number;
  bySubject: { subjectId: string; activeCount: number }[];
  /** 各知识点子树内的 ACTIVE 数量 */
  byKnowledgePoint: { knowledgePointId: string; activeCount: number }[];
}

export abstract class WrongQuestionRepository {
  /** 事务内 upsert：错误次数 +1、连续答对归零、置为 ACTIVE */
  abstract recordWrong(handle: TransactionHandle, data: WrongAnswerData): Promise<void>;

  /** 事务内：ACTIVE 且 statDate 晚于 lastCorrectDate 时连续答对 +1，达到阈值置为 MASTERED */
  abstract recordCorrect(handle: TransactionHandle, data: CorrectAnswerData): Promise<void>;

  /** 科目内 ACTIVE 且题目（及所属材料）已发布的题目，按最近错误时间倒序 */
  abstract findActivePublishedQuestionIds(userId: number, subjectId: string): Promise<string[]>;

  /** questionIds 中位于错题本的题目 */
  abstract findQuestionIdsInBook(userId: number, questionIds: string[]): Promise<string[]>;

  abstract findManyWithPaginationAndCount(
    filter: WrongBookFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: WrongQuestion[]; total: number }>;

  abstract countSummary(userId: number, weekStart: Date, subjectId?: string): Promise<WrongBookCounts>;

  /** 手动移出；不存在时返回 null */
  abstract master(userId: number, questionId: string): Promise<NullableType<WrongQuestion>>;

  /** 已掌握的恢复为 ACTIVE 且连续答对归零；不存在时返回 null */
  abstract restore(userId: number, questionId: string): Promise<NullableType<WrongQuestion>>;
}
