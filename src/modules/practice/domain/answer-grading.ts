import { QuestionType } from '../../questions/domain/question-type';
import { QuestionAnswer } from '../../questions/domain/question-answer';
import { gradeObjective, isObjectiveType } from '../../questions/domain/objective-grading';
import { matchFillBlank } from '../../questions/domain/fill-answer';
import { MultiScoringRule } from '../../papers/domain/multi-scoring-rule';
import { SelfAssessment } from './answer-record';

export interface GradeOptions {
  /** 题目分值；为空时不计分 */
  fullScore?: number | null;
  multiScoringRule?: MultiScoringRule;
}

export interface GradeResult {
  isCorrect: boolean | null;
  isPartial: boolean;
  score: number | null;
}

const UNGRADED: GradeResult = { isCorrect: null, isPartial: false, score: null };

const toCents = (value: number): number => Math.round(value * 100);
const fromCents = (cents: number): number => cents / 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 每空分值保留两位小数，末空补齐差额 */
export function allocateBlankScores(fullScore: number, blankCount: number): number[] {
  if (blankCount <= 0) {
    return [];
  }
  const cents = toCents(fullScore);
  let each = Math.round(cents / blankCount);
  if (each * (blankCount - 1) > cents) {
    each = Math.floor(cents / blankCount);
  }
  return Array.from({ length: blankCount }, (_, index) =>
    fromCents(index === blankCount - 1 ? cents - each * (blankCount - 1) : each),
  );
}

function gradeMultiple(
  answer: QuestionAnswer,
  userAnswer: unknown,
  fullScore: number | null,
  rule: MultiScoringRule,
): GradeResult {
  const isCorrect = gradeObjective(QuestionType.MULTIPLE, answer, userAnswer)!;
  if (isCorrect) {
    return { isCorrect, isPartial: false, score: fullScore };
  }
  const expected = 'keys' in answer ? new Set(answer.keys) : new Set<string>();
  const keys = isRecord(userAnswer) && Array.isArray(userAnswer.keys) ? (userAnswer.keys as unknown[]) : [];
  const isPartial =
    rule === MultiScoringRule.PARTIAL &&
    keys.length > 0 &&
    new Set(keys).size === keys.length &&
    keys.every((key) => typeof key === 'string' && expected.has(key));
  const score = fullScore === null ? null : isPartial ? fromCents(Math.round(toCents(fullScore) / 2)) : 0;
  return { isCorrect: false, isPartial, score };
}

function gradeFill(answer: QuestionAnswer, userAnswer: unknown, fullScore: number | null): GradeResult {
  const isCorrect = gradeObjective(QuestionType.FILL, answer, userAnswer)!;
  if (fullScore === null || !('blanks' in answer)) {
    return { isCorrect, isPartial: false, score: fullScore === null ? null : isCorrect ? fullScore : 0 };
  }
  const blanks = isRecord(userAnswer) && Array.isArray(userAnswer.blanks) ? (userAnswer.blanks as unknown[]) : [];
  const scores = allocateBlankScores(fullScore, answer.blanks.length);
  const cents = answer.blanks.reduce((sum, candidates, index) => {
    const value = blanks[index];
    return typeof value === 'string' && matchFillBlank(candidates, value) ? sum + toCents(scores[index]) : sum;
  }, 0);
  return { isCorrect, isPartial: false, score: fromCents(cents) };
}

/** 按题目最新答案判分客观题；主观题与材料返回未判分；非模考按全对判定多选 */
export function gradeAnswer(
  type: QuestionType,
  answer: QuestionAnswer | null,
  userAnswer: unknown,
  options: GradeOptions = {},
): GradeResult {
  if (!isObjectiveType(type) || answer === null) {
    return UNGRADED;
  }
  const fullScore = options.fullScore ?? null;
  switch (type) {
    case QuestionType.MULTIPLE:
      return gradeMultiple(answer, userAnswer, fullScore, options.multiScoringRule ?? MultiScoringRule.ALL_OR_NOTHING);
    case QuestionType.FILL:
      return gradeFill(answer, userAnswer, fullScore);
    default: {
      const isCorrect = gradeObjective(type, answer, userAnswer)!;
      return { isCorrect, isPartial: false, score: fullScore === null ? null : isCorrect ? fullScore : 0 };
    }
  }
}

export function gradeSelfAssessment(selfAssessment: SelfAssessment): boolean {
  return selfAssessment === SelfAssessment.KNOWN;
}
