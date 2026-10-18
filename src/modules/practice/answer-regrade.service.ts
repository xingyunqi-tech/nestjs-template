import { Injectable } from '@nestjs/common';
import {
  AnswerRegradeRepository,
  RegradeChange,
  RegradeScope,
  SessionScoreDelta,
} from './infrastructure/persistence/answer-regrade.repository';
import { gradeAnswer } from './domain/answer-grading';
import { PracticeMode } from './domain/practice-mode';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionAnswer } from '../questions/domain/question-answer';
import { isObjectiveType } from '../questions/domain/objective-grading';
import { businessDate } from '../papers/domain/business-date';
import { TransactionHandle } from '../../common/database/transaction-handle';

export interface ErrataTarget {
  questionId: string;
  toVersion: number;
  type: QuestionType;
}

/** 已计入统计且对错发生变化的作答 */
export interface ChangedStatsRecord {
  statDate: string;
  subjectId: string;
  firstForQuestion: boolean;
  isCorrect: boolean;
}

const toCents = (value: number): number => Math.round(value * 100);

function scopeOf(target: ErrataTarget): RegradeScope {
  return { questionId: target.questionId, toVersion: target.toVersion, objective: isObjectiveType(target.type) };
}

/** 勘误后按最新答案重判历史作答 */
@Injectable()
export class AnswerRegradeService {
  constructor(private readonly repository: AnswerRegradeRepository) {}

  raiseInProgressSessionVersions(handle: TransactionHandle, questionId: string, version: number): Promise<number> {
    return this.repository.raiseInProgressSessionVersions(handle, questionId, version);
  }

  countPendingUsers(target: ErrataTarget, errataId: string): Promise<number> {
    return this.repository.countPendingUsers(scopeOf(target), errataId);
  }

  findPendingUsers(target: ErrataTarget, afterUserId: number, limit: number): Promise<number[]> {
    return this.repository.findPendingUsers(scopeOf(target), afterUserId, limit);
  }

  /** 事务内重判该用户的客观题记录并重算会话得分与正确数，主观题只更新版本 */
  async regradeUser(
    handle: TransactionHandle,
    userId: number,
    target: ErrataTarget,
    answer: QuestionAnswer | null,
  ): Promise<ChangedStatsRecord[]> {
    const scope = scopeOf(target);
    const records = await this.repository.lockPendingRecords(handle, userId, scope);
    const changes: RegradeChange[] = [];
    const sessions = new Map<string, SessionScoreDelta>();
    const changedStats: ChangedStatsRecord[] = [];
    for (const record of records) {
      if (!scope.objective || record.isCorrect === null) {
        continue;
      }
      const isMock = record.mode === PracticeMode.MOCK;
      const grade = gradeAnswer(
        target.type,
        answer,
        record.answer,
        isMock ? { fullScore: record.paperScore ?? 0, multiScoringRule: record.multiScoringRule ?? undefined } : {},
      );
      if (grade.isCorrect === null) {
        continue;
      }
      const score = isMock ? (grade.score ?? 0) : record.score;
      if (grade.isCorrect === record.isCorrect && grade.isPartial === record.isPartial && score === record.score) {
        continue;
      }
      changes.push({ id: record.id, isCorrect: grade.isCorrect, isPartial: grade.isPartial, score });
      const delta = sessions.get(record.sessionId) ?? { sessionId: record.sessionId, correct: 0, scoreCents: 0 };
      delta.correct += Number(grade.isCorrect) - Number(record.isCorrect);
      if (score !== null && record.score !== null) {
        delta.scoreCents += toCents(score) - toCents(record.score);
      }
      sessions.set(record.sessionId, delta);
      if (record.statsAppliedAt !== null && grade.isCorrect !== record.isCorrect) {
        changedStats.push({
          statDate: record.statDate ?? businessDate(record.gradedAt ?? new Date()),
          subjectId: record.subjectId,
          firstForQuestion: record.firstForQuestion,
          isCorrect: grade.isCorrect,
        });
      }
    }
    await this.repository.writeRegrades(
      handle,
      records.map((record) => record.id),
      changes,
      target.toVersion,
    );
    await this.repository.adjustSessionScores(handle, [...sessions.values()]);
    return changedStats;
  }
}
