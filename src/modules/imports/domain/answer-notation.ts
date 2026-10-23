import { QuestionType } from '../../questions/domain/question-type';
import { QuestionAnswer, QuestionOption } from '../../questions/domain/question-answer';

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

const OPTION_LINE = /^[(（]?([A-Za-zＡ-Ｚａ-ｚ])(?:[)）]|\s*[.．、:：])\s*(.*)$/s;
const OPTION_KEY_COUNT = 26;

function toOptionKey(letter: string): string {
  const code = letter.charCodeAt(0);
  return (code > 0xff ? String.fromCharCode(code - 0xfee0) : letter).toUpperCase();
}

/** 每行一个选项：全部以字母加「. ． 、 : ：」或「(A) （A） A) A）」开头时按前缀取 key（全角与小写字母按大写处理），全部不带前缀时按顺序编号为 A、B、C…；混用或超过 26 行时返回 undefined */
export function parseOptionLines(lines: string[]): QuestionOption[] | undefined {
  const prefixed = lines
    .map((line) => OPTION_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  if (prefixed.length === lines.length) {
    return prefixed.map((match) => ({ key: toOptionKey(match[1]), content: match[2].trim() }));
  }
  if (prefixed.length > 0 || lines.length > OPTION_KEY_COUNT) {
    return undefined;
  }
  return lines.map((content, index) => ({ key: String.fromCharCode(65 + index), content }));
}
