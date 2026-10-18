import { NullableType } from '../../../../common/types/nullable.type';
import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { UserDailyStat } from '../../domain/user-daily-stat';
import { UserKnowledgeStat } from '../../domain/user-knowledge-stat';

export interface KnowledgeResultData {
  userId: number;
  knowledgePointIds: string[];
  isCorrect: boolean;
  answeredAt: Date;
}

export interface DailyStatDelta {
  userId: number;
  date: string;
  subjectId: string;
  answered: number;
  correct: number;
  durationSec: number;
}

export interface MockSessionDuration {
  date: string;
  subjectId: string;
  durationSec: number;
}

/** 知识点子树内按作答记录去重后的统计，answeredQuestionCount 只计当前已发布的题目 */
export interface SubtreeAnswerAggregate {
  knowledgePointId: string;
  answered: number;
  correct: number;
  recentAnswered: number;
  recentCorrect: number;
  answeredQuestionCount: number;
}

/** 知识点子树内已发布题目数（按题去重） */
export interface SubtreeQuestionCount {
  knowledgePointId: string;
  questionCount: number;
}

export interface DailyTotals {
  answered: number;
  correct: number;
  durationSec: number;
}

export abstract class LearningStatsRepository {
  /** 每个叶子知识点 answered + 1，recentResults 追加后保留最近 20 位 */
  abstract applyKnowledgeResult(handle: TransactionHandle, data: KnowledgeResultData): Promise<void>;

  abstract addDailyStat(handle: TransactionHandle, delta: DailyStatDelta): Promise<void>;

  /** 会话内此前没有已计入的其他记录时返回会话用时与交卷统计日，否则返回 null */
  abstract claimMockSessionDuration(
    handle: TransactionHandle,
    sessionId: string,
    recordId: string,
  ): Promise<NullableType<MockSessionDuration>>;

  /** 科目内当前仍为叶子的知识点统计 */
  abstract findLeafStats(userId: number, subjectId: string): Promise<UserKnowledgeStat[]>;

  /** 科目内每个知识点（含叶子）的子树作答聚合，仅返回有作答的节点 */
  abstract aggregateSubtreeAnswers(userId: number, subjectId: string): Promise<SubtreeAnswerAggregate[]>;

  /** 科目内每个知识点（含叶子）的子树已发布题目数，仅返回有题目的节点 */
  abstract countSubtreeQuestions(subjectId: string): Promise<SubtreeQuestionCount[]>;

  abstract findDailyStats(userId: number, from: string, to: string): Promise<UserDailyStat[]>;

  /** examId 限定该考试下的科目，date 限定统计日 */
  abstract sumDailyStats(userId: number, filter: { examId?: string; date?: string }): Promise<DailyTotals>;
}
