import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocx } from './docx.mjs';
import { evaluateExtraction, evaluateFormulas, expectedFormulaSequence } from './evaluate.mjs';
import { extractQuestions } from './extract.mjs';
import { estimateCost, llmConfigFromEnv } from './llm.mjs';
import { normalizeText } from './normalize.mjs';
import { parsePdf } from './pdf.mjs';
import { renderReport } from './report.mjs';
import { questionUnits, splitAnswerArea } from './segment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLES = [
  { id: 's1', kind: 'docx', file: 's1-xingce.docx', expected: 's1-xingce.json' },
  { id: 's2', kind: 'docx', file: 's2-math.docx', expected: 's2-math.json', formulas: { answersAtEnd: true } },
  { id: 's3', kind: 'pdf', file: 's3-two-column.pdf', expected: 's3-two-column.json' },
  { id: 's3t', kind: 'pdf', file: 's3-short-tail.pdf', expected: 's3-two-column.json', parseOnly: true },
  { id: 's4', kind: 'docx', file: 's4-material.docx', expected: 's4-material.json' },
  { id: 's5', kind: 'docx', file: 's5-questions.docx', answerFile: 's5-answers.docx', expected: 's5-split.json' },
  { id: 's6', kind: 'pdf', file: 's6-scanned.pdf', expected: 's6-scanned.json' },
  {
    id: 's7',
    kind: 'docx',
    file: 's7-math-handmade.docx',
    expected: 's7-math-handmade.json',
    formulas: { answersAtEnd: false },
  },
];

const { values: args } = parseArgs({
  options: {
    stage: { type: 'string', default: 'all' },
    samples: { type: 'string' },
    'chunk-size': { type: 'string' },
    'samples-dir': { type: 'string', default: path.resolve(ROOT, '../samples') },
    out: { type: 'string', default: path.join(ROOT, 'out') },
  },
});

const chunkSize = Number(args['chunk-size'] ?? process.env.CHUNK_SIZE ?? 15);
const selected = args.samples ? new Set(args.samples.split(',')) : null;
const samples = SAMPLES.filter((s) => !selected || selected.has(s.id));

async function parseFile(kind, file, outDir) {
  if (kind === 'pdf') return parsePdf(file);
  return parseDocx(file, outDir);
}

function parseCheck(expected, text) {
  const { questions } = splitAnswerArea(text);
  const { units } = questionUnits(questions);
  const numbers = units.map((u) => u.number);
  const expectedNumbers = expected.questions.map((q) => q.number);
  const inOrder = numbers.join(',') === expectedNumbers.join(',');
  const byNumber = new Map(units.map((u) => [u.number, normalizeText(u.text)]));
  const missingStems = expected.questions
    .filter((q) => !(byNumber.get(q.number) ?? '').includes(normalizeText(q.stem)))
    .map((q) => q.number);
  return { detectedNumbers: numbers.length, expectedNumbers: expectedNumbers.length, inOrder, missingStems };
}

async function runParse(sample, outDir) {
  const dir = path.join(args['samples-dir'], 'output');
  const expected = JSON.parse(await readFile(path.join(args['samples-dir'], 'expected', sample.expected), 'utf8'));
  const started = Date.now();
  const parsed = await parseFile(sample.kind, path.join(dir, sample.file), outDir);
  const answer = sample.answerFile ? await parseFile('docx', path.join(dir, sample.answerFile), outDir) : null;
  const durationMs = Date.now() - started;

  await writeFile(path.join(outDir, 'text.txt'), `${parsed.text}\n`);
  if (answer) await writeFile(path.join(outDir, 'answers.txt'), `${answer.text}\n`);

  const result = {
    id: sample.id,
    kind: sample.kind,
    sources: [sample.file, sample.answerFile].filter(Boolean),
    expect: expected.expect,
    durationMs,
    chars: parsed.text.replace(/\s/g, '').length,
    rejected: Boolean(parsed.scanned),
    pages: parsed.pages,
    lowTextPages: parsed.lowTextPages,
    removedHeaderFooter: parsed.removedHeaderFooter,
    images: parsed.images,
    warnings: [...(parsed.warnings ?? []), ...(answer?.warnings ?? [])],
    formulaCount: parsed.formulas?.length ?? 0,
    formulaParts: parsed.formulaParts ?? [],
    droppedFormulas: parsed.droppedFormulas ?? 0,
    oleEquations: (parsed.oleEquations ?? 0) + (answer?.oleEquations ?? 0),
    unknownMath: parsed.unknownMath ?? {},
  };
  if (!result.rejected && expected.expect === 'extract') {
    result.check = parseCheck(expected, parsed.text);
  }
  if (sample.formulas) {
    result.formulaEval = evaluateFormulas(
      expectedFormulaSequence(expected, sample.formulas.answersAtEnd),
      parsed.formulas ?? [],
    );
    await writeFile(path.join(outDir, 'formulas.json'), `${JSON.stringify(parsed.formulas, null, 2)}\n`);
  }
  await writeFile(path.join(outDir, 'parse.json'), `${JSON.stringify(result, null, 2)}\n`);
  return { result, expected, text: parsed.text, answerText: answer?.text ?? '' };
}

function sumUsage(calls) {
  return calls.reduce(
    (acc, c) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + c.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + c.cachedInputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      durationMs: acc.durationMs + c.durationMs,
      lengthRetries: acc.lengthRetries + (c.finishReason === 'length' ? 1 : 0),
      parseErrors: acc.parseErrors + (c.parseError ? 1 : 0),
      errors: acc.errors + (c.error ? 1 : 0),
    }),
    {
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      lengthRetries: 0,
      parseErrors: 0,
      errors: 0,
    },
  );
}

async function main() {
  const llm = llmConfigFromEnv();
  const runExtract = args.stage !== 'parse' && Boolean(llm.apiKey);
  await mkdir(args.out, { recursive: true });

  const rows = [];
  for (const sample of samples) {
    const outDir = path.join(args.out, sample.id);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const parsed = await runParse(sample, outDir);
    const row = { parse: parsed.result };
    console.log(
      `[parse] ${sample.id} ${parsed.result.rejected ? 'REJECTED (scanned)' : `${parsed.result.chars} chars`}`,
    );

    if (runExtract && !parsed.result.rejected && !sample.parseOnly) {
      const calls = [];
      try {
        const extracted = await extractQuestions(llm, {
          text: parsed.text,
          answerText: parsed.answerText,
          chunkSize,
          label: sample.id,
          calls,
        });
        await writeFile(path.join(outDir, 'extracted.json'), `${JSON.stringify(extracted, null, 2)}\n`);
        const usage = sumUsage(extracted.calls);
        row.extract = {
          chunks: extracted.chunks,
          answerChunks: extracted.answerChunks,
          answersFound: extracted.answersFound,
          answerConflicts: extracted.answerConflicts,
          conflicts: extracted.conflicts,
          usage: { ...usage, cost: estimateCost(llm, usage) },
          calls: extracted.calls,
          metrics: evaluateExtraction(parsed.expected, extracted),
        };
      } catch (error) {
        const usage = sumUsage(calls);
        row.extract = {
          error: error instanceof Error ? error.message : String(error),
          usage: { ...usage, cost: estimateCost(llm, usage) },
          calls,
        };
        console.error(`[extract] ${sample.id} failed: ${row.extract.error}`);
      }
      for (const c of calls) {
        const status = c.error ? ` error=${c.error}` : c.parseError ? ` parseError=${c.parseError}` : '';
        console.log(
          `[llm] ${c.label} in=${c.inputTokens} cached=${c.cachedInputTokens} out=${c.outputTokens} finish=${c.finishReason} ${c.durationMs}ms${status}`,
        );
      }
    }
    rows.push(row);
  }

  const skipReason = args.stage === 'parse' ? '以 --stage parse 运行' : llm.apiKey ? null : '未设置 LLM_API_KEY';
  if (skipReason) console.log(`[extract] 跳过阶段二：${skipReason}。设置 LLM_API_KEY 后重新运行即可执行提取与评估。`);

  const summary = { generatedAt: new Date().toISOString(), chunkSize, model: llm.model, skipReason, rows };
  await writeFile(path.join(args.out, 'metrics.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(args.out, 'report.md'), renderReport(summary));
  console.log(`[report] ${path.relative(process.cwd(), path.join(args.out, 'report.md'))}`);
}

await main();
