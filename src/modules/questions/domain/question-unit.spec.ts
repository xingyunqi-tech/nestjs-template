import { Question } from './question';
import { QuestionType } from './question-type';
import { groupIntoUnits, packUnits, takeLeadingUnits } from './question-unit';

const question = (id: string, parentId: string | null = null, type = QuestionType.SINGLE): Question =>
  Object.assign(new Question(), { id, parentId, type });

describe('packUnits', () => {
  it('should fill the target without splitting units', () => {
    const units = [
      { id: 'm1', size: 4 },
      { id: 'q1', size: 1 },
      { id: 'm2', size: 3 },
      { id: 'q2', size: 1 },
      { id: 'q3', size: 1 },
    ];
    expect(packUnits(units, 5).map((unit) => unit.id)).toEqual(['m1', 'q1']);
    expect(packUnits(units, 3).map((unit) => unit.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('should take the first unit when none fits', () => {
    expect(packUnits([{ id: 'm1', size: 6 }], 3).map((unit) => unit.id)).toEqual(['m1']);
    expect(packUnits([], 3)).toEqual([]);
    expect(packUnits([{ id: 'm1', size: 0 }], 3)).toEqual([]);
  });
});

describe('takeLeadingUnits', () => {
  it('should include the whole material that reaches the count', () => {
    const units = [
      { root: question('q1'), questions: [question('q1')] },
      { root: question('m1', null, QuestionType.MATERIAL), questions: [question('s1', 'm1'), question('s2', 'm1')] },
      { root: question('q2'), questions: [question('q2')] },
    ];
    expect(takeLeadingUnits(units, 2).map((unit) => unit.root.id)).toEqual(['q1', 'm1']);
    expect(takeLeadingUnits(units, 1).map((unit) => unit.root.id)).toEqual(['q1']);
  });
});

describe('groupIntoUnits', () => {
  it('should group consecutive sub-questions under their material', () => {
    const material = question('m1', null, QuestionType.MATERIAL);
    const units = groupIntoUnits(
      [question('q1'), question('s1', 'm1'), question('s2', 'm1'), question('q2'), question('s3', 'missing')],
      new Map([['m1', material]]),
    );
    expect(units.map((unit) => [unit.root.id, unit.questions.map((item) => item.id)])).toEqual([
      ['q1', ['q1']],
      ['m1', ['s1', 's2']],
      ['q2', ['q2']],
    ]);
  });
});
