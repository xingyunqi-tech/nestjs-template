import {
  QuestionContent,
  QuestionContentViolation,
  normalizeAnswer,
  validateQuestionContent,
} from './question-content';
import { QuestionType } from './question-type';

const OPTIONS = [
  { key: 'A', content: '甲' },
  { key: 'B', content: '乙' },
  { key: 'C', content: '丙' },
];

const content = (overrides: Partial<QuestionContent>): QuestionContent => ({
  type: QuestionType.SINGLE,
  stem: '题干',
  options: OPTIONS,
  answer: { keys: ['B'] },
  analysis: null,
  material: null,
  audioFileId: null,
  knowledgePointIds: [],
  ...overrides,
});

const violationOf = (overrides: Partial<QuestionContent>, isSubQuestion = false) =>
  validateQuestionContent(content(overrides), isSubQuestion)?.violation ?? null;

describe('validateQuestionContent', () => {
  it('should accept valid answers for each type', () => {
    expect(violationOf({})).toBeNull();
    expect(violationOf({ type: QuestionType.MULTIPLE, answer: { keys: ['A', 'C'] } })).toBeNull();
    expect(violationOf({ type: QuestionType.JUDGE, options: null, answer: { value: false } })).toBeNull();
    expect(
      violationOf({ type: QuestionType.FILL, options: null, answer: { blanks: [['北京', '北京市'], ['1']] } }),
    ).toBeNull();
    expect(
      violationOf({ type: QuestionType.SHORT_ANSWER, options: null, answer: { reference: '要点', points: ['一'] } }),
    ).toBeNull();
    expect(violationOf({ type: QuestionType.ESSAY, options: null, answer: {} })).toBeNull();
  });

  it('should reject choice questions with invalid options', () => {
    expect(violationOf({ options: [{ key: 'A', content: '甲' }] })).toBe(QuestionContentViolation.INVALID_OPTIONS);
    expect(
      violationOf({
        options: [
          { key: 'A', content: '甲' },
          { key: 'A', content: '乙' },
        ],
      }),
    ).toBe(QuestionContentViolation.INVALID_OPTIONS);
    expect(violationOf({ options: null })).toBe(QuestionContentViolation.INVALID_OPTIONS);
    expect(violationOf({ type: QuestionType.JUDGE, answer: { value: true } })).toBe(
      QuestionContentViolation.INVALID_OPTIONS,
    );
  });

  it('should reject answers that do not match the type', () => {
    expect(violationOf({ answer: { keys: ['A', 'B'] } })).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(violationOf({ answer: { keys: ['D'] } })).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(violationOf({ answer: null })).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(violationOf({ type: QuestionType.MULTIPLE, answer: { keys: ['A', 'A'] } })).toBe(
      QuestionContentViolation.INVALID_ANSWER,
    );
    expect(violationOf({ type: QuestionType.JUDGE, options: null, answer: { value: 'true' } as never })).toBe(
      QuestionContentViolation.INVALID_ANSWER,
    );
    expect(violationOf({ type: QuestionType.FILL, options: null, answer: { blanks: [[]] } })).toBe(
      QuestionContentViolation.INVALID_ANSWER,
    );
    expect(violationOf({ answer: { keys: ['B'], extra: 1 } as never })).toBe(QuestionContentViolation.INVALID_ANSWER);
  });

  it('should limit the size of fill and short answers', () => {
    const fill = (blanks: string[][]) => violationOf({ type: QuestionType.FILL, options: null, answer: { blanks } });
    expect(fill(Array.from({ length: 20 }, () => ['a']))).toBeNull();
    expect(fill(Array.from({ length: 21 }, () => ['a']))).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(fill([Array.from({ length: 11 }, (_, i) => `${i}`)])).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(fill([['x'.repeat(501)]])).toBe(QuestionContentViolation.INVALID_ANSWER);

    const short = (answer: object) => violationOf({ type: QuestionType.SHORT_ANSWER, options: null, answer: answer });
    expect(short({ reference: 'r', points: Array.from({ length: 21 }, () => 'p') })).toBe(
      QuestionContentViolation.INVALID_ANSWER,
    );
    expect(short({ reference: 'r', points: ['p'.repeat(501)] })).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(short({ reference: 'r'.repeat(20001), points: [] })).toBe(QuestionContentViolation.INVALID_ANSWER);
    expect(violationOf({ type: QuestionType.ESSAY, options: null, answer: { reference: 'r'.repeat(20001) } })).toBe(
      QuestionContentViolation.INVALID_ANSWER,
    );
  });

  it('should only allow material and audio on material questions', () => {
    expect(violationOf({ material: '资料' })).toBe(QuestionContentViolation.MATERIAL_FIELDS_NOT_ALLOWED);
    expect(violationOf({ audioFileId: 'f1' })).toBe(QuestionContentViolation.MATERIAL_FIELDS_NOT_ALLOWED);
  });

  it('should validate material containers', () => {
    const material = { type: QuestionType.MATERIAL, options: null, answer: null, material: '资料' };
    expect(violationOf(material)).toBeNull();
    expect(violationOf({ ...material, material: null, audioFileId: 'f1' })).toBeNull();
    expect(violationOf({ ...material, material: '  ' })).toBe(QuestionContentViolation.MATERIAL_CONTENT_REQUIRED);
    expect(violationOf({ ...material, knowledgePointIds: ['k1'] })).toBe(
      QuestionContentViolation.MATERIAL_KNOWLEDGE_POINTS_NOT_ALLOWED,
    );
    expect(violationOf(material, true)).toBe(QuestionContentViolation.INVALID_PARENT);
  });
});

describe('normalizeAnswer', () => {
  it('should sort choice keys', () => {
    expect(normalizeAnswer(QuestionType.MULTIPLE, { keys: ['C', 'A'] })).toEqual({ keys: ['A', 'C'] });
    expect(normalizeAnswer(QuestionType.JUDGE, { value: true })).toEqual({ value: true });
  });
});
