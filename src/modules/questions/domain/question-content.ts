import { Question } from './question';
import { QuestionType } from './question-type';
import { QuestionAnswer } from './question-answer';

export type QuestionContent = Pick<
  Question,
  'type' | 'stem' | 'options' | 'answer' | 'analysis' | 'material' | 'audioFileId' | 'knowledgePointIds'
>;

export enum QuestionContentViolation {
  INVALID_OPTIONS = 'invalidQuestionOptions',
  INVALID_ANSWER = 'invalidQuestionAnswer',
  MATERIAL_FIELDS_NOT_ALLOWED = 'materialFieldsNotAllowed',
  MATERIAL_CONTENT_REQUIRED = 'materialContentRequired',
  MATERIAL_KNOWLEDGE_POINTS_NOT_ALLOWED = 'materialKnowledgePointsNotAllowed',
  INVALID_PARENT = 'invalidQuestionParent',
}

export type QuestionContentError = { field: string; violation: QuestionContentViolation };

const OPTION_KEY = /^[A-Z]$/;

export const ANSWER_LIMITS = {
  blanks: 20,
  candidatesPerBlank: 10,
  candidateLength: 500,
  points: 20,
  pointLength: 500,
  referenceLength: 20000,
} as const;
const CHOICE_TYPES = new Set([QuestionType.SINGLE, QuestionType.MULTIPLE]);

type AnswerRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnswerRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: AnswerRecord, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown, maxLength = Infinity): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maxLength;
}

function isValidChoiceAnswer(answer: AnswerRecord, type: QuestionType, optionKeys: Set<string>): boolean {
  const keys = answer.keys;
  if (!hasOnlyKeys(answer, ['keys']) || !Array.isArray(keys) || keys.length === 0) {
    return false;
  }
  if (type === QuestionType.SINGLE && keys.length !== 1) {
    return false;
  }
  return new Set(keys).size === keys.length && keys.every((key) => typeof key === 'string' && optionKeys.has(key));
}

function isValidAnswer(type: QuestionType, answer: unknown, optionKeys: Set<string>): boolean {
  if (!isRecord(answer)) {
    return false;
  }
  switch (type) {
    case QuestionType.SINGLE:
    case QuestionType.MULTIPLE:
      return isValidChoiceAnswer(answer, type, optionKeys);
    case QuestionType.JUDGE:
      return hasOnlyKeys(answer, ['value']) && typeof answer.value === 'boolean';
    case QuestionType.FILL:
      return (
        hasOnlyKeys(answer, ['blanks']) &&
        Array.isArray(answer.blanks) &&
        answer.blanks.length > 0 &&
        answer.blanks.length <= ANSWER_LIMITS.blanks &&
        answer.blanks.every(
          (candidates) =>
            Array.isArray(candidates) &&
            candidates.length > 0 &&
            candidates.length <= ANSWER_LIMITS.candidatesPerBlank &&
            candidates.every((candidate) => isBoundedString(candidate, ANSWER_LIMITS.candidateLength)),
        )
      );
    case QuestionType.SHORT_ANSWER:
      return (
        hasOnlyKeys(answer, ['reference', 'points', 'rubricId']) &&
        isBoundedString(answer.reference, ANSWER_LIMITS.referenceLength) &&
        Array.isArray(answer.points) &&
        answer.points.length <= ANSWER_LIMITS.points &&
        answer.points.every((point) => isBoundedString(point, ANSWER_LIMITS.pointLength)) &&
        isOptionalString(answer.rubricId)
      );
    case QuestionType.ESSAY:
      return (
        hasOnlyKeys(answer, ['reference', 'rubricId']) &&
        isOptionalString(answer.reference, ANSWER_LIMITS.referenceLength) &&
        isOptionalString(answer.rubricId)
      );
    default:
      return false;
  }
}

function validateMaterial(content: QuestionContent, isSubQuestion: boolean): QuestionContentError | null {
  if (isSubQuestion) {
    return { field: 'parentId', violation: QuestionContentViolation.INVALID_PARENT };
  }
  if (content.options !== null) {
    return { field: 'options', violation: QuestionContentViolation.INVALID_OPTIONS };
  }
  if (content.answer !== null) {
    return { field: 'answer', violation: QuestionContentViolation.INVALID_ANSWER };
  }
  if (content.knowledgePointIds.length > 0) {
    return { field: 'knowledgePointIds', violation: QuestionContentViolation.MATERIAL_KNOWLEDGE_POINTS_NOT_ALLOWED };
  }
  if (!content.material?.trim() && !content.audioFileId) {
    return { field: 'material', violation: QuestionContentViolation.MATERIAL_CONTENT_REQUIRED };
  }
  return null;
}

export function validateQuestionContent(content: QuestionContent, isSubQuestion: boolean): QuestionContentError | null {
  if (content.type === QuestionType.MATERIAL) {
    return validateMaterial(content, isSubQuestion);
  }
  if (content.material !== null || content.audioFileId !== null) {
    return { field: 'material', violation: QuestionContentViolation.MATERIAL_FIELDS_NOT_ALLOWED };
  }

  const isChoice = CHOICE_TYPES.has(content.type);
  const optionKeys = new Set((content.options ?? []).map((option) => option.key));
  const validOptions = isChoice
    ? content.options !== null &&
      content.options.length >= 2 &&
      optionKeys.size === content.options.length &&
      content.options.every((option) => OPTION_KEY.test(option.key))
    : content.options === null;
  if (!validOptions) {
    return { field: 'options', violation: QuestionContentViolation.INVALID_OPTIONS };
  }
  if (!isValidAnswer(content.type, content.answer, optionKeys)) {
    return { field: 'answer', violation: QuestionContentViolation.INVALID_ANSWER };
  }
  return null;
}

/** 选择题答案 key 按字母排序后保存 */
export function normalizeAnswer(type: QuestionType, answer: QuestionAnswer | null): QuestionAnswer | null {
  if (answer && CHOICE_TYPES.has(type) && 'keys' in answer && Array.isArray(answer.keys)) {
    return { ...answer, keys: [...answer.keys].sort() };
  }
  return answer;
}
