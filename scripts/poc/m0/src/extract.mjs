import { completeJson } from './llm.mjs';
import { normalizeAnswer } from './normalize.mjs';
import { answerChunks, chunkUnits, questionUnits, splitAnswerArea } from './segment.mjs';

export const PROMPT_VERSION = 'm0-2026-10-20';

const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF', 'optionG', 'optionH'];

const QUESTION_SYSTEM = `你是题库录入助手，把 <document> 中的试卷原文整理成结构化题目，输出 JSON。
规则：
1. 只做结构化，不改写、不润色、不补全题干和选项文字；原文中的 $...$ 公式、![](assets/...) 图片、Markdown 表格原样保留。
2. 题干 stem 不含题号，不含选项、答案、解析；图片或表格属于题干时放在 stem 末尾，与文字之间空一行。
3. 选项拆到 optionA…optionH，不含「A．」等前缀；同一行用空白或制表符分隔的多个选项要拆开。
4. type 取值：SINGLE 单选、MULTIPLE 多选、JUDGE 判断、FILL 填空、SHORT_ANSWER 简答/解答、ESSAY 作文/申论。多选题依据题干「正确的有」「属于…的有」等表述或答案字母数判断。
5. answer：单选写字母；多选按字母顺序连写如 ABD；判断写「对」或「错」；填空同一空的多个可接受答案用 | 分隔，不同空之间用 || 分隔；主观题写参考答案原文。原文没有给出答案时 answer 写空字符串，不得自行作答或编造。
6. analysis 写【解析】的内容，没有就省略；主观题的「评分要点」写进 points，每条一行，去掉①②等序号和末尾分号。
7. 材料题：材料（含引导语和表格）放进 materials，每组一个 materialKey（m1、m2…），stem 写引导语（如「根据以下资料，回答 1～4 题。」），material 写材料正文；属于该材料的题目带上 materialKey 和 order（组内从 1 开始）。
8. number 写题目在原文中的题号（整数）。原文片段开头或结尾不完整的题目也照常输出。
输出格式：{"materials":[{"materialKey":"m1","stem":"","material":""}],"questions":[{"number":1,"type":"SINGLE","materialKey":"m1","order":1,"stem":"","optionA":"","optionB":"","answer":"","analysis":"","points":""}]}`;

const ANSWER_SYSTEM = `你是题库录入助手，<document> 中是试卷的参考答案部分（可能是逐题列出、表格、或「1—5：B、A、…」这样的区间形式），把它整理成按题号排列的答案，输出 JSON。
规则：
1. 只摘录原文，不自行作答，不改写；$...$ 公式原样保留。
2. answer：选择题写字母（多选按字母顺序连写如 ABD）；判断写「对」或「错」；填空同一空的多个可接受答案用 | 分隔（原文用 / 或「或」分隔的同义答案也改用 |），不同空之间用 || 分隔；主观题写参考答案原文。
3. analysis 写解析内容，没有就省略；「评分要点」写进 points，每条一行，去掉①②等序号和末尾分号。
4. 区间形式要展开，例如「1—5：B、A、B、A、ABD」展开为 1 到 5 题各自的答案。
输出格式：{"answers":[{"number":1,"answer":"B","analysis":"","points":""}]}`;

export const MAX_SPLIT_DEPTH = 3;

function wrap(text) {
  return `<document>\n${text}\n</document>\n\n按要求输出 JSON。`;
}

function failedUsage(config, label, error) {
  return {
    label,
    model: config.model,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    finishReason: 'error',
    durationMs: error?.durationMs ?? 0,
  };
}

async function callOnce(config, system, user, label, items, calls, extra = {}) {
  try {
    const result = await completeJson(config, { system, user, label });
    calls.push({ ...result.usage, items, parseError: result.parseError, ...extra });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    calls.push({ ...failedUsage(config, label, error), items, error: message, ...extra });
    return { json: null, usage: { finishReason: 'error' }, parseError: null, error: message };
  }
}

async function callWithSplit(config, items, render, system, label, calls, depth = 0) {
  const extra = depth ? { retry: true, depth } : {};
  const user = wrap(render(items));
  let result = await callOnce(config, system, user, label, items.length, calls, extra);
  if (!result.json && result.parseError) {
    result = await callOnce(config, system, user, `${label}~retry`, items.length, calls, {
      ...extra,
      parseRetry: true,
    });
  }
  if (result.json) return [result.json];
  if (result.usage.finishReason === 'length' && items.length > 1 && depth < MAX_SPLIT_DEPTH) {
    const half = Math.ceil(items.length / 2);
    const out = [];
    for (const [i, part] of [items.slice(0, half), items.slice(half)].entries()) {
      out.push(...(await callWithSplit(config, part, render, system, `${label}.${i + 1}`, calls, depth + 1)));
    }
    return out;
  }
  return [];
}

function cleanQuestion(q) {
  const row = { number: Number(q.number), type: q.type, stem: q.stem ?? '' };
  for (const key of OPTION_KEYS) if (q[key]) row[key] = q[key];
  for (const key of ['materialKey', 'order', 'answer', 'analysis', 'points']) {
    if (q[key] !== undefined && q[key] !== null && q[key] !== '') row[key] = q[key];
  }
  return row;
}

export async function extractQuestions(config, { text, answerText, chunkSize, label, calls = [] }) {
  const area = splitAnswerArea(text);
  const answersSource = [area.answers, answerText].filter(Boolean).join('\n\n');
  const { units, materials } = questionUnits(area.questions);
  const chunks = chunkUnits(units, materials, chunkSize);

  const questions = [];
  const outMaterials = [];
  for (const [index, chunk] of chunks.entries()) {
    const results = await callWithSplit(
      config,
      chunk,
      (items) => items.map((u) => u.text).join('\n'),
      QUESTION_SYSTEM,
      `${label}#q${index + 1}`,
      calls,
    );
    for (const [part, json] of results.entries()) {
      const prefix = `c${index + 1}p${part + 1}-`;
      for (const m of json.materials ?? []) {
        outMaterials.push({ ...m, materialKey: prefix + m.materialKey });
      }
      for (const q of json.questions ?? []) {
        const row = cleanQuestion(q);
        if (row.materialKey) row.materialKey = prefix + row.materialKey;
        questions.push(row);
      }
    }
  }

  const answers = new Map();
  const pieces = answersSource ? answerChunks(answersSource, chunkSize) : [];
  for (const [index, piece] of pieces.entries()) {
    const results = await callWithSplit(
      config,
      piece.entries,
      (items) => [piece.header, ...items].filter(Boolean).join('\n'),
      ANSWER_SYSTEM,
      `${label}#a${index + 1}`,
      calls,
    );
    for (const json of results) {
      for (const a of json.answers ?? []) answers.set(Number(a.number), a);
    }
  }

  let answerConflicts = 0;
  const conflicts = [];
  for (const q of questions) {
    const a = answers.get(q.number);
    if (!a) continue;
    if (a.answer) {
      if (q.answer && normalizeAnswer(q.answer, q.type) !== normalizeAnswer(a.answer, q.type)) {
        answerConflicts += 1;
        conflicts.push({ number: q.number, inline: q.answer, answerArea: a.answer });
      }
      q.answer = a.answer;
    }
    if (a.analysis) q.analysis = a.analysis;
    if (a.points) q.points = a.points;
  }

  return {
    promptVersion: PROMPT_VERSION,
    chunks: chunks.map((c) => c.map((u) => u.number)),
    answerChunks: pieces.length,
    answersFound: answers.size,
    answerConflicts,
    conflicts,
    materials: outMaterials,
    questions,
    calls,
  };
}
