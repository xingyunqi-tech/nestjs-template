import { QuestionType } from '../../questions/domain/question-type';
import { QuestionAnswer } from '../../questions/domain/question-answer';

const JUDGE_VALUES: Readonly<Record<string, boolean>> = {
  对: true,
  正确: true,
  是: true,
  '√': true,
  true: true,
  t: true,
  错: false,
  错误: false,
  否: false,
  '×': false,
  false: false,
  f: false,
};

const CHOICE_SEPARATORS = /[\s,，、;；]/g;

/** 填空答案：|| 分隔空，| 分隔同一空的候选，\| 与 \\ 为转义，其余 \ 原样保留 */
export function parseFillNotation(text: string): string[][] {
  const blanks: string[][] = [];
  let candidates: string[] = [];
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '\\' && (next === '|' || next === '\\')) {
      current += next;
      index++;
    } else if (char === '|' && next === '|') {
      candidates.push(current.trim());
      blanks.push(candidates);
      candidates = [];
      current = '';
      index++;
    } else if (char === '|') {
      candidates.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  candidates.push(current.trim());
  blanks.push(candidates);
  return blanks;
}

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** 按导入包答案写法转换为题目答案结构；无法识别时返回 undefined，结构是否合法由题目校验判断 */
export function parseAnswerNotation(
  type: QuestionType,
  answer: string,
  points: string,
): QuestionAnswer | null | undefined {
  const text = answer.trim();
  switch (type) {
    case QuestionType.SINGLE:
    case QuestionType.MULTIPLE: {
      const keys = text.replace(CHOICE_SEPARATORS, '').toUpperCase();
      return /^[A-Z]+$/.test(keys) ? { keys: [...keys] } : undefined;
    }
    case QuestionType.JUDGE: {
      const value = JUDGE_VALUES[text.toLowerCase()];
      return value === undefined ? undefined : { value };
    }
    case QuestionType.FILL:
      return text ? { blanks: parseFillNotation(text) } : undefined;
    case QuestionType.SHORT_ANSWER:
      return { reference: text, points: splitLines(points) };
    case QuestionType.ESSAY:
      return text ? { reference: text } : {};
    default:
      return null;
  }
}
