import { allocateBlankScores, gradeAnswer, gradeSelfAssessment } from './answer-grading';
import { SelfAssessment } from './answer-record';
import { QuestionType } from '../../questions/domain/question-type';
import { MultiScoringRule } from '../../papers/domain/multi-scoring-rule';

describe('gradeAnswer', () => {
  it('should grade single choice by exact match', () => {
    expect(gradeAnswer(QuestionType.SINGLE, { keys: ['B'] }, { keys: ['B'] })).toEqual({
      isCorrect: true,
      isPartial: false,
      score: null,
    });
    expect(gradeAnswer(QuestionType.SINGLE, { keys: ['B'] }, { keys: ['A'] }, { fullScore: 2 })).toEqual({
      isCorrect: false,
      isPartial: false,
      score: 0,
    });
  });

  it('should grade judge questions', () => {
    expect(gradeAnswer(QuestionType.JUDGE, { value: true }, { value: true }, { fullScore: 1 }).score).toBe(1);
    expect(gradeAnswer(QuestionType.JUDGE, { value: true }, { value: false }).isCorrect).toBe(false);
  });

  it('should treat a malformed answer as wrong', () => {
    expect(gradeAnswer(QuestionType.SINGLE, { keys: ['B'] }, 'B').isCorrect).toBe(false);
  });

  describe('multiple choice', () => {
    const answer = { keys: ['A', 'C', 'D'] };

    it('should give full score only when all keys match under all-or-nothing', () => {
      expect(gradeAnswer(QuestionType.MULTIPLE, answer, { keys: ['D', 'A', 'C'] }, { fullScore: 2 })).toEqual({
        isCorrect: true,
        isPartial: false,
        score: 2,
      });
      expect(
        gradeAnswer(
          QuestionType.MULTIPLE,
          answer,
          { keys: ['A', 'C'] },
          {
            fullScore: 2,
            multiScoringRule: MultiScoringRule.ALL_OR_NOTHING,
          },
        ),
      ).toEqual({ isCorrect: false, isPartial: false, score: 0 });
    });

    it('should give half score for a missing key without wrong keys under partial rule', () => {
      expect(
        gradeAnswer(
          QuestionType.MULTIPLE,
          answer,
          { keys: ['A', 'C'] },
          {
            fullScore: 3,
            multiScoringRule: MultiScoringRule.PARTIAL,
          },
        ),
      ).toEqual({ isCorrect: false, isPartial: true, score: 1.5 });
    });

    it('should give zero for any wrong key under partial rule', () => {
      expect(
        gradeAnswer(
          QuestionType.MULTIPLE,
          answer,
          { keys: ['A', 'B'] },
          {
            fullScore: 3,
            multiScoringRule: MultiScoringRule.PARTIAL,
          },
        ),
      ).toEqual({ isCorrect: false, isPartial: false, score: 0 });
    });

    it('should judge by all-or-nothing when no rule is given', () => {
      expect(gradeAnswer(QuestionType.MULTIPLE, answer, { keys: ['A'] })).toEqual({
        isCorrect: false,
        isPartial: false,
        score: null,
      });
    });
  });

  describe('fill blanks', () => {
    it('should match normalized candidates', () => {
      expect(gradeAnswer(QuestionType.FILL, { blanks: [['ABC']] }, { blanks: ['\uff41\uff42\uff43 '] }).isCorrect).toBe(
        true,
      );
      expect(gradeAnswer(QuestionType.FILL, { blanks: [['1000']] }, { blanks: ['1,000'] }).isCorrect).toBe(true);
    });

    it('should split the score per blank and let the last blank take the difference', () => {
      const answer = { blanks: [['a'], ['b'], ['c']] };
      expect(gradeAnswer(QuestionType.FILL, answer, { blanks: ['a', 'b', 'c'] }, { fullScore: 2 })).toEqual({
        isCorrect: true,
        isPartial: false,
        score: 2,
      });
      expect(gradeAnswer(QuestionType.FILL, answer, { blanks: ['a', 'x', 'c'] }, { fullScore: 2 })).toEqual({
        isCorrect: false,
        isPartial: false,
        score: 1.33,
      });
      expect(gradeAnswer(QuestionType.FILL, answer, { blanks: ['x', 'x', 'c'] }, { fullScore: 2 }).score).toBe(0.66);
    });

    it('should be wrong when the blank count differs', () => {
      expect(gradeAnswer(QuestionType.FILL, { blanks: [['a'], ['b']] }, { blanks: ['a'] }, { fullScore: 2 })).toEqual({
        isCorrect: false,
        isPartial: false,
        score: 1,
      });
    });
  });

  it('should leave subjective questions and materials ungraded', () => {
    const ungraded = { isCorrect: null, isPartial: false, score: null };
    expect(gradeAnswer(QuestionType.SHORT_ANSWER, { reference: 'r', points: [] }, { text: 't' })).toEqual(ungraded);
    expect(gradeAnswer(QuestionType.ESSAY, {}, { text: 't' })).toEqual(ungraded);
    expect(gradeAnswer(QuestionType.MATERIAL, null, {})).toEqual(ungraded);
  });
});

describe('allocateBlankScores', () => {
  it('should round each blank to two decimals', () => {
    expect(allocateBlankScores(2, 3)).toEqual([0.67, 0.67, 0.66]);
    expect(allocateBlankScores(1, 3)).toEqual([0.33, 0.33, 0.34]);
    expect(allocateBlankScores(4.25, 2)).toEqual([2.13, 2.12]);
  });

  it('should never produce a negative last blank', () => {
    const scores = allocateBlankScores(0.05, 7);
    expect(scores.every((score) => score >= 0)).toBe(true);
    expect(Math.round(scores.reduce((sum, score) => sum + score, 0) * 100)).toBe(5);
  });

  it('should return no scores without blanks', () => {
    expect(allocateBlankScores(2, 0)).toEqual([]);
  });
});

describe('gradeSelfAssessment', () => {
  it('should map known to correct and unknown to wrong', () => {
    expect(gradeSelfAssessment(SelfAssessment.KNOWN)).toBe(true);
    expect(gradeSelfAssessment(SelfAssessment.UNKNOWN)).toBe(false);
  });
});
