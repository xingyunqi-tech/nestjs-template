import { QuestionOperatorDto, operatorName, toQuestionOperator } from './question-operator.dto';
import { OperatorProfile } from '../domain/question-operator';

const profile = (overrides: Partial<OperatorProfile> = {}): OperatorProfile => ({
  id: 7,
  nickname: '小王',
  email: 'wang@example.com',
  ...overrides,
});

describe('operatorName', () => {
  it('should prefer the nickname, then email', () => {
    expect(operatorName(7, profile())).toBe('小王');
    expect(operatorName(7, profile({ nickname: '  ' }))).toBe('wang@example.com');
  });

  it('should fall back to the user id when neither nickname nor email is set or the user is missing', () => {
    expect(operatorName(7, profile({ nickname: null, email: '' }))).toBe('用户7');
    expect(operatorName(7, undefined)).toBe('用户7');
  });
});

describe('toQuestionOperator', () => {
  it('should return null without an operator id', () => {
    expect(toQuestionOperator(null, new Map())).toBeNull();
  });

  it('should build the id and display name', () => {
    const operator = toQuestionOperator(7, new Map([[7, profile()]]));

    expect(operator).toBeInstanceOf(QuestionOperatorDto);
    expect(operator).toEqual({ id: 7, name: '小王' });
  });
});
