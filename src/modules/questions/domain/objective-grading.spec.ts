import { gradeObjective, isObjectiveType } from './objective-grading';
import { QuestionType } from './question-type';

describe('gradeObjective', () => {
  it('should grade single choice by exact key', () => {
    expect(gradeObjective(QuestionType.SINGLE, { keys: ['B'] }, { keys: ['B'] })).toBe(true);
    expect(gradeObjective(QuestionType.SINGLE, { keys: ['B'] }, { keys: ['A'] })).toBe(false);
    expect(gradeObjective(QuestionType.SINGLE, { keys: ['B'] }, { keys: ['A', 'B'] })).toBe(false);
  });

  it('should require all keys for multiple choice regardless of order', () => {
    expect(gradeObjective(QuestionType.MULTIPLE, { keys: ['A', 'C'] }, { keys: ['C', 'A'] })).toBe(true);
    expect(gradeObjective(QuestionType.MULTIPLE, { keys: ['A', 'C'] }, { keys: ['A'] })).toBe(false);
    expect(gradeObjective(QuestionType.MULTIPLE, { keys: ['A', 'C'] }, { keys: ['A', 'C', 'D'] })).toBe(false);
    expect(gradeObjective(QuestionType.MULTIPLE, { keys: ['A', 'C'] }, { keys: ['A', 'A'] })).toBe(false);
  });

  it('should grade judge questions by value', () => {
    expect(gradeObjective(QuestionType.JUDGE, { value: true }, { value: true })).toBe(true);
    expect(gradeObjective(QuestionType.JUDGE, { value: true }, { value: false })).toBe(false);
    expect(gradeObjective(QuestionType.JUDGE, { value: false }, { value: 'false' })).toBe(false);
  });

  it('should match fill blanks after normalization', () => {
    const answer = { blanks: [['北京', 'Beijing'], ['1000']] };
    expect(gradeObjective(QuestionType.FILL, answer, { blanks: [' beijing ', '1,000'] })).toBe(true);
    expect(
      gradeObjective(QuestionType.FILL, answer, { blanks: ['\uFF22\uFF25\uFF29\uFF2A\uFF29\uFF2E\uFF27', '1000'] }),
    ).toBe(true);
    expect(gradeObjective(QuestionType.FILL, answer, { blanks: ['上海', '1000'] })).toBe(false);
    expect(gradeObjective(QuestionType.FILL, answer, { blanks: ['北京'] })).toBe(false);
  });

  it('should treat malformed user answers as wrong', () => {
    expect(gradeObjective(QuestionType.SINGLE, { keys: ['B'] }, null)).toBe(false);
    expect(gradeObjective(QuestionType.SINGLE, { keys: ['B'] }, 'B')).toBe(false);
    expect(gradeObjective(QuestionType.FILL, { blanks: [['a']] }, { blanks: [1] })).toBe(false);
  });

  it('should not grade subjective questions and materials', () => {
    expect(gradeObjective(QuestionType.SHORT_ANSWER, { reference: 'r', points: [] }, { text: 'r' })).toBeNull();
    expect(gradeObjective(QuestionType.ESSAY, {}, { text: 'r' })).toBeNull();
    expect(gradeObjective(QuestionType.MATERIAL, null, {})).toBeNull();
    expect(isObjectiveType(QuestionType.FILL)).toBe(true);
    expect(isObjectiveType(QuestionType.ESSAY)).toBe(false);
  });
});
