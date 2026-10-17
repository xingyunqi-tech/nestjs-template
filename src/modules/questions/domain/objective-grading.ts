import { QuestionType } from './question-type';
import { QuestionAnswer } from './question-answer';
import { matchFillBlank } from './fill-answer';

export const OBJECTIVE_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  QuestionType.SINGLE,
  QuestionType.MULTIPLE,
  QuestionType.JUDGE,
  QuestionType.FILL,
]);

export function isObjectiveType(type: QuestionType): boolean {
  return OBJECTIVE_QUESTION_TYPES.has(type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function sameKeySet(expected: string[], actual: string[]): boolean {
  const actualSet = new Set(actual);
  return (
    actualSet.size === actual.length &&
    actualSet.size === expected.length &&
    expected.every((key) => actualSet.has(key))
  );
}

/** 单选、多选（全对）、判断、填空（归一化逐空匹配）判分；主观题与材料返回 null，作答格式不符视为错误 */
export function gradeObjective(type: QuestionType, answer: QuestionAnswer | null, userAnswer: unknown): boolean | null {
  if (!isObjectiveType(type) || answer === null) {
    return null;
  }
  if (!isRecord(userAnswer)) {
    return false;
  }
  switch (type) {
    case QuestionType.SINGLE:
    case QuestionType.MULTIPLE:
      return 'keys' in answer && isStringArray(userAnswer.keys) && sameKeySet(answer.keys, userAnswer.keys);
    case QuestionType.JUDGE:
      return 'value' in answer && typeof userAnswer.value === 'boolean' && userAnswer.value === answer.value;
    case QuestionType.FILL: {
      if (!('blanks' in answer) || !isStringArray(userAnswer.blanks)) {
        return false;
      }
      const blanks = userAnswer.blanks;
      return (
        blanks.length === answer.blanks.length &&
        answer.blanks.every((candidates, index) => matchFillBlank(candidates, blanks[index]))
      );
    }
    default:
      return null;
  }
}
