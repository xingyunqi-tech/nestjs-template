import { isUUID } from 'class-validator';
import { QuestionType } from '../../questions/domain/question-type';
import { Question } from '../../questions/domain/question';

export const ANSWER_LIMITS = {
  maxKeys: 26,
  maxBlanks: 50,
  maxBlankLength: 200,
  maxTextLength: 5000,
  maxImages: 9,
} as const;

export type InspectedAnswer =
  { kind: 'empty' } | { kind: 'filled'; answer: Record<string, unknown> } | { kind: 'invalid' } | { kind: 'mismatch' };

const EMPTY: InspectedAnswer = { kind: 'empty' };
const INVALID: InspectedAnswer = { kind: 'invalid' };
const MISMATCH: InspectedAnswer = { kind: 'mismatch' };

export type AnswerTarget = Pick<Question, 'type' | 'options' | 'answer'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === 'string' && item.length <= maxLength)
  );
}

function inspectSubjective(answer: Record<string, unknown>): InspectedAnswer {
  const { text, imageFileIds } = answer;
  if (text !== undefined && text !== null && (typeof text !== 'string' || text.length > ANSWER_LIMITS.maxTextLength)) {
    return INVALID;
  }
  if (
    imageFileIds !== undefined &&
    imageFileIds !== null &&
    !(
      Array.isArray(imageFileIds) &&
      imageFileIds.length <= ANSWER_LIMITS.maxImages &&
      imageFileIds.every((id) => typeof id === 'string' && isUUID(id))
    )
  ) {
    return INVALID;
  }
  const trimmed = typeof text === 'string' ? text.trim() : '';
  const images = Array.isArray(imageFileIds)
    ? [...new Set((imageFileIds as string[]).map((id) => id.toLowerCase()))]
    : [];
  if (trimmed === '' && images.length === 0) {
    return EMPTY;
  }
  return {
    kind: 'filled',
    answer: { ...(trimmed !== '' && { text }), ...(images.length > 0 && { imageFileIds: images }) },
  };
}

function blankCountOf(target: AnswerTarget): number | null {
  return target.answer && 'blanks' in target.answer ? target.answer.blanks.length : null;
}

/** 校验作答结构并去除多余字段；未作答返回 empty，结构正确但与题目不符（选项不存在、单选多于一项、空数不符）返回 mismatch */
export function inspectAnswer(target: AnswerTarget, answer: unknown): InspectedAnswer {
  if (answer === null || answer === undefined) {
    return EMPTY;
  }
  if (!isRecord(answer)) {
    return INVALID;
  }
  switch (target.type) {
    case QuestionType.SINGLE:
    case QuestionType.MULTIPLE: {
      if (answer.keys === undefined || answer.keys === null) {
        return EMPTY;
      }
      if (!isStringArray(answer.keys, ANSWER_LIMITS.maxKeys, ANSWER_LIMITS.maxBlankLength)) {
        return INVALID;
      }
      const keys = answer.keys;
      if (keys.length === 0) {
        return EMPTY;
      }
      const optionKeys = new Set((target.options ?? []).map((option) => option.key));
      if (
        new Set(keys).size !== keys.length ||
        keys.some((key) => !optionKeys.has(key)) ||
        (target.type === QuestionType.SINGLE && keys.length !== 1)
      ) {
        return MISMATCH;
      }
      return { kind: 'filled', answer: { keys: [...keys] } };
    }
    case QuestionType.JUDGE:
      if (answer.value === undefined || answer.value === null) {
        return EMPTY;
      }
      return typeof answer.value === 'boolean' ? { kind: 'filled', answer: { value: answer.value } } : INVALID;
    case QuestionType.FILL: {
      if (answer.blanks === undefined || answer.blanks === null) {
        return EMPTY;
      }
      if (!isStringArray(answer.blanks, ANSWER_LIMITS.maxBlanks, ANSWER_LIMITS.maxBlankLength)) {
        return INVALID;
      }
      if (answer.blanks.every((blank) => blank.trim() === '')) {
        return EMPTY;
      }
      return answer.blanks.length === blankCountOf(target)
        ? { kind: 'filled', answer: { blanks: [...answer.blanks] } }
        : MISMATCH;
    }
    case QuestionType.SHORT_ANSWER:
    case QuestionType.ESSAY:
      return inspectSubjective(answer);
    default:
      return INVALID;
  }
}

export function isSubjectiveType(type: QuestionType): boolean {
  return type === QuestionType.SHORT_ANSWER || type === QuestionType.ESSAY;
}
