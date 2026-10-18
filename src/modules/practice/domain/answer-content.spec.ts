import { AnswerTarget, inspectAnswer } from './answer-content';
import { QuestionType } from '../../questions/domain/question-type';

const IMAGE_ID = '0F8FAD5B-D9CB-469F-A165-70867728950E';
const OPTIONS = ['A', 'B', 'C'].map((key) => ({ key, content: key }));

const target = (type: QuestionType, overrides: Partial<AnswerTarget> = {}): AnswerTarget => ({
  type,
  options: null,
  answer: null,
  ...overrides,
});
const SINGLE = target(QuestionType.SINGLE, { options: OPTIONS, answer: { keys: ['B'] } });
const MULTIPLE = target(QuestionType.MULTIPLE, { options: OPTIONS, answer: { keys: ['A', 'B'] } });
const JUDGE = target(QuestionType.JUDGE, { answer: { value: true } });
const FILL = target(QuestionType.FILL, { answer: { blanks: [['x'], ['y']] } });
const SHORT = target(QuestionType.SHORT_ANSWER, { answer: { reference: 'r', points: [] } });

describe('inspectAnswer', () => {
  it('should treat missing or blank answers as empty', () => {
    expect(inspectAnswer(SINGLE, null)).toEqual({ kind: 'empty' });
    expect(inspectAnswer(MULTIPLE, { keys: [] })).toEqual({ kind: 'empty' });
    expect(inspectAnswer(JUDGE, {})).toEqual({ kind: 'empty' });
    expect(inspectAnswer(FILL, { blanks: [' ', ''] })).toEqual({ kind: 'empty' });
    expect(inspectAnswer(SHORT, { text: '  ', imageFileIds: [] })).toEqual({ kind: 'empty' });
  });

  it('should keep only the fields of the question type', () => {
    expect(inspectAnswer(SINGLE, { keys: ['A'], extra: 1 })).toEqual({ kind: 'filled', answer: { keys: ['A'] } });
    expect(inspectAnswer(MULTIPLE, { keys: ['C', 'A'] })).toEqual({ kind: 'filled', answer: { keys: ['C', 'A'] } });
    expect(inspectAnswer(JUDGE, { value: false })).toEqual({ kind: 'filled', answer: { value: false } });
    expect(inspectAnswer(FILL, { blanks: ['x', ''] })).toEqual({ kind: 'filled', answer: { blanks: ['x', ''] } });
    expect(inspectAnswer(target(QuestionType.ESSAY), { text: '答', imageFileIds: [IMAGE_ID, IMAGE_ID] })).toEqual({
      kind: 'filled',
      answer: { text: '答', imageFileIds: [IMAGE_ID.toLowerCase()] },
    });
  });

  it('should reject answers whose structure does not match the question type', () => {
    expect(inspectAnswer(SINGLE, 'A')).toEqual({ kind: 'invalid' });
    expect(inspectAnswer(SINGLE, { keys: [1] })).toEqual({ kind: 'invalid' });
    expect(inspectAnswer(JUDGE, { value: 'true' })).toEqual({ kind: 'invalid' });
    expect(inspectAnswer(FILL, { blanks: 'x' })).toEqual({ kind: 'invalid' });
    expect(inspectAnswer(SHORT, { imageFileIds: ['not-a-uuid'] })).toEqual({ kind: 'invalid' });
    expect(inspectAnswer(target(QuestionType.MATERIAL), {})).toEqual({ kind: 'invalid' });
  });

  it('should report answers that do not match the options or blanks of the question', () => {
    expect(inspectAnswer(SINGLE, { keys: ['D'] })).toEqual({ kind: 'mismatch' });
    expect(inspectAnswer(SINGLE, { keys: ['A', 'B'] })).toEqual({ kind: 'mismatch' });
    expect(inspectAnswer(MULTIPLE, { keys: ['A', 'A'] })).toEqual({ kind: 'mismatch' });
    expect(inspectAnswer(MULTIPLE, { keys: ['A', 'Z'] })).toEqual({ kind: 'mismatch' });
    expect(inspectAnswer(FILL, { blanks: ['x'] })).toEqual({ kind: 'mismatch' });
    expect(inspectAnswer(FILL, { blanks: ['x', 'y', 'z'] })).toEqual({ kind: 'mismatch' });
  });
});
