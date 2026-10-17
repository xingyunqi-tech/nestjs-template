import { isAnswerChange, isSnapshotChanged } from './question-edit-rules';
import { QuestionContent } from './question-content';
import { QuestionType } from './question-type';

const base: QuestionContent = {
  type: QuestionType.SINGLE,
  stem: '题干',
  options: [
    { key: 'A', content: '甲' },
    { key: 'B', content: '乙' },
  ],
  answer: { keys: ['B'] },
  analysis: '解析',
  material: null,
  audioFileId: null,
  knowledgePointIds: ['k1', 'k2'],
};

const fill: QuestionContent = { ...base, type: QuestionType.FILL, options: null, answer: { blanks: [['一'], ['二']] } };

describe('question edit rules', () => {
  it('should allow wording changes of stem, options and analysis', () => {
    const next = {
      ...base,
      stem: '题干（修订）',
      options: [
        { key: 'A', content: '甲方' },
        { key: 'B', content: '乙方' },
      ],
      analysis: '新解析',
    };
    expect(isAnswerChange(base, next)).toBe(false);
    expect(isSnapshotChanged(base, next)).toBe(true);
  });

  it('should treat answer, type and option key changes as answer changes', () => {
    expect(isAnswerChange(base, { ...base, answer: { keys: ['A'] } })).toBe(true);
    expect(isAnswerChange(base, { ...base, type: QuestionType.MULTIPLE })).toBe(true);
    expect(isAnswerChange(base, { ...base, options: [...base.options!, { key: 'C', content: '丙' }] })).toBe(true);
  });

  it('should treat a different number of blanks as an answer change', () => {
    expect(isAnswerChange(fill, { ...fill, answer: { blanks: [['一']] } })).toBe(true);
  });

  it('should ignore key order inside the answer object', () => {
    const essay: QuestionContent = {
      ...base,
      type: QuestionType.ESSAY,
      options: null,
      answer: { reference: 'r', rubricId: 'x' },
    };
    expect(isAnswerChange(essay, { ...essay, answer: { rubricId: 'x', reference: 'r' } })).toBe(false);
  });

  it('should detect knowledge point changes regardless of order', () => {
    expect(isSnapshotChanged(base, { ...base, knowledgePointIds: ['k2', 'k1'] })).toBe(false);
    expect(isSnapshotChanged(base, { ...base, knowledgePointIds: ['k1'] })).toBe(true);
    expect(isSnapshotChanged(base, { ...base })).toBe(false);
  });
});
