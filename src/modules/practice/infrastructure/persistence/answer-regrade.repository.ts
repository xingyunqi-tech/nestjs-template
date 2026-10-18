import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { MultiScoringRule } from '../../../papers/domain/multi-scoring-rule';
import { AnswerRecord } from '../../domain/answer-record';
import { PracticeSession } from '../../domain/practice-session';

/** 勘误待修正的作答：该题版本低于 toVersion 的记录，客观题只取已判分的 */
export interface RegradeScope {
  questionId: string;
  toVersion: number;
  objective: boolean;
}

export type RegradeRecord = Pick<
  AnswerRecord,
  | 'id'
  | 'sessionId'
  | 'answer'
  | 'isCorrect'
  | 'isPartial'
  | 'score'
  | 'gradedAt'
  | 'statDate'
  | 'statsAppliedAt'
  | 'firstForQuestion'
> &
  Pick<PracticeSession, 'mode' | 'subjectId'> & {
    /** 会话所属试卷中该题的分值 */
    paperScore: number | null;
    multiScoringRule: MultiScoringRule | null;
  };

export interface RegradeChange {
  id: AnswerRecord['id'];
  isCorrect: boolean | null;
  isPartial: boolean;
  score: number | null;
}

export interface SessionScoreDelta {
  sessionId: PracticeSession['id'];
  correct: number;
  scoreCents: number;
}

export abstract class AnswerRegradeRepository {
  /** 事务内把进行中会话里该题的版本更新为 version，返回更新的会话数 */
  abstract raiseInProgressSessionVersions(
    handle: TransactionHandle,
    questionId: string,
    version: number,
  ): Promise<number>;

  /** 有待修正作答的用户数，不含该勘误已记录处理过的用户 */
  abstract countPendingUsers(scope: RegradeScope, errataId: string): Promise<number>;

  /** 有待修正作答且 userId 大于 afterUserId 的用户，升序取 limit 个 */
  abstract findPendingUsers(scope: RegradeScope, afterUserId: number, limit: number): Promise<number[]>;

  /** 事务内先按 id 锁定所属会话，再锁定并返回该用户待修正的作答 */
  abstract lockPendingRecords(handle: TransactionHandle, userId: number, scope: RegradeScope): Promise<RegradeRecord[]>;

  /** 写入判分结果，并把记录版本更新为 toVersion；ids 中其余记录只更新版本 */
  abstract writeRegrades(
    handle: TransactionHandle,
    ids: AnswerRecord['id'][],
    changes: RegradeChange[],
    toVersion: number,
  ): Promise<void>;

  /** 增减会话正确数与得分；得分为空的会话不改得分 */
  abstract adjustSessionScores(handle: TransactionHandle, deltas: SessionScoreDelta[]): Promise<void>;
}
