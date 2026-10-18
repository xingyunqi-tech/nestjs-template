import { wrongBookOutcomeOf } from './stats-outcome';
import { QuestionType } from '../../questions/domain/question-type';

describe('wrongBookOutcomeOf', () => {
  const base = { isCorrect: true, questionType: QuestionType.SINGLE, statDate: '2026-10-17' };

  it('should count an incorrect objective answer as wrong', () => {
    expect(wrongBookOutcomeOf({ ...base, isCorrect: false })).toBe('wrong');
  });

  it('should count a partially correct multiple choice answer as wrong', () => {
    expect(wrongBookOutcomeOf({ ...base, isCorrect: false, questionType: QuestionType.MULTIPLE })).toBe('wrong');
  });

  it('should count a subjective answer self-assessed as unknown as wrong', () => {
    expect(wrongBookOutcomeOf({ ...base, isCorrect: false, questionType: QuestionType.SHORT_ANSWER })).toBe('wrong');
  });

  it('should count a correct objective answer with a stat date as correct', () => {
    expect(wrongBookOutcomeOf(base)).toBe('correct');
  });

  it('should ignore subjective answers self-assessed as known', () => {
    expect(wrongBookOutcomeOf({ ...base, questionType: QuestionType.SHORT_ANSWER })).toBe('ignored');
    expect(wrongBookOutcomeOf({ ...base, questionType: QuestionType.ESSAY })).toBe('ignored');
  });

  it('should ignore correct answers without a stat date', () => {
    expect(wrongBookOutcomeOf({ ...base, statDate: null })).toBe('ignored');
  });
});
