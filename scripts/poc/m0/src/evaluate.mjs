import { extractFormulas, normalizeAnswer, normalizeLatex, normalizeText } from './normalize.mjs';

const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF', 'optionG', 'optionH'];
const SPLIT_SIMILARITY = 0.9;

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  const x = [...a];
  const y = [...b];
  const len = Math.max(x.length, y.length);
  return len ? 1 - levenshtein(x, y) / len : 1;
}

function lcsAlign(expected, actual) {
  const n = expected.length;
  const m = actual.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = expected[i] === actual[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matchedExpected = new Set();
  const matchedActual = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === actual[j]) {
      matchedExpected.add(i);
      matchedActual.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return { matched: dp[0][0], matchedExpected, matchedActual };
}

export function expectedFormulaSequence(expected, answersAtEnd) {
  const body = (q) => [q.stem, ...OPTION_KEYS.map((k) => q[k])];
  const tail = (q) => [q.answer, q.analysis];
  const fields = answersAtEnd
    ? [...expected.questions.flatMap(body), ...expected.questions.flatMap(tail)]
    : expected.questions.flatMap((q) => [...body(q), ...tail(q)]);
  return fields.flatMap(extractFormulas);
}

export function evaluateFormulas(expectedLatex, actualLatex) {
  const exp = expectedLatex.map(normalizeLatex);
  const act = actualLatex.map(normalizeLatex);
  const { matched, matchedExpected, matchedActual } = lcsAlign(exp, act);
  return {
    expected: exp.length,
    actual: act.length,
    matched,
    rate: exp.length ? matched / exp.length : 1,
    extra: act.length - matched,
    missing: expectedLatex.map((f, i) => ({ index: i, latex: f })).filter((x) => !matchedExpected.has(x.index)),
    unexpected: actualLatex.map((f, i) => ({ index: i, latex: f })).filter((x) => !matchedActual.has(x.index)),
  };
}

function formulaHits(expectedField, actualField) {
  const want = extractFormulas(expectedField).map(normalizeLatex);
  const have = extractFormulas(actualField).map(normalizeLatex);
  let hit = 0;
  for (const f of want) {
    const at = have.indexOf(f);
    if (at >= 0) {
      hit += 1;
      have.splice(at, 1);
    }
  }
  return { total: want.length, hit, extra: have.length };
}

function imageCount(text) {
  return [...String(text ?? '').matchAll(/!\[[^\]]*\]\([^)]*\)/g)].length;
}

function splitMaterial(text) {
  const lines = String(text ?? '').split('\n');
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const rows = lines
    .filter(isRow)
    .filter((l) => !/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l))
    .map((l) =>
      l
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => normalizeText(c)),
    );
  return { body: normalizeText(lines.filter((l) => !isRow(l)).join('\n')), table: JSON.stringify(rows) };
}

function matchMaterials(expected, extracted, byNumber) {
  const mapping = new Map();
  for (const m of expected.materials) {
    const votes = new Map();
    for (const q of expected.questions.filter((x) => x.materialKey === m.materialKey)) {
      const key = byNumber.get(q.number)?.[0]?.materialKey;
      if (key) votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) mapping.set(m.materialKey, best);
  }
  return mapping;
}

function rate(ok, total) {
  return { ok, total, rate: total ? ok / total : null };
}

export function evaluateExtraction(expected, extracted) {
  const byNumber = new Map();
  for (const q of extracted.questions) {
    const list = byNumber.get(q.number) ?? [];
    list.push(q);
    byNumber.set(q.number, list);
  }
  const expectedNumbers = new Set(expected.questions.map((q) => q.number));
  const extra = extracted.questions.filter((q) => !expectedNumbers.has(q.number));
  const materialMap = matchMaterials(expected, extracted, byNumber);
  const hasMaterials = expected.materials.length > 0 || extracted.questions.some((q) => q.materialKey);

  let split = 0;
  let stemExact = 0;
  let typeOk = 0;
  let options = 0;
  let optionTotal = 0;
  let answers = 0;
  let answerTotal = 0;
  let formulaHit = 0;
  let formulaTotal = 0;
  let formulaExtra = 0;
  let imagesOk = 0;
  let imageTotal = 0;
  let attribution = 0;
  const failures = [];

  for (const exp of expected.questions) {
    const rows = byNumber.get(exp.number) ?? [];
    const act = rows[0];
    const expStem = normalizeText(exp.stem);
    const actStem = act ? normalizeText(act.stem) : '';
    const stemSim = act ? similarity(expStem, actStem) : 0;
    const splitOk = rows.length === 1 && stemSim >= SPLIT_SIMILARITY;
    if (splitOk) split += 1;
    else
      failures.push({
        number: exp.number,
        field: 'split',
        detail: `rows=${rows.length} stemSimilarity=${stemSim.toFixed(2)}`,
      });
    if (rows.length === 1 && expStem === actStem) stemExact += 1;
    else if (splitOk) failures.push({ number: exp.number, field: 'stem', detail: act.stem });

    if (act?.type === exp.type) typeOk += 1;

    const wantImages = imageCount(exp.stem);
    const haveImages = imageCount(act?.stem);
    if (wantImages || haveImages) {
      imageTotal += 1;
      if (wantImages === haveImages) imagesOk += 1;
      else
        failures.push({ number: exp.number, field: 'images', detail: `expected=${wantImages} actual=${haveImages}` });
    }

    if (exp.optionA !== undefined) {
      optionTotal += 1;
      const bad = OPTION_KEYS.filter((k) => normalizeText(exp[k]) !== normalizeText(act?.[k]));
      if (!bad.length) options += 1;
      else failures.push({ number: exp.number, field: 'options', detail: bad.join(',') });
    }

    if (exp.answer) {
      answerTotal += 1;
      const ok = normalizeAnswer(exp.answer, exp.type) === normalizeAnswer(act?.answer, exp.type);
      if (ok) answers += 1;
      else
        failures.push({
          number: exp.number,
          field: 'answer',
          detail: `expected=${exp.answer} actual=${act?.answer ?? ''}`,
        });
    }

    if (hasMaterials) {
      const wantKey = exp.materialKey ? (materialMap.get(exp.materialKey) ?? null) : null;
      const ok = exp.materialKey
        ? Boolean(wantKey) && act?.materialKey === wantKey && Number(act?.order) === exp.order
        : act !== undefined && !act.materialKey;
      if (ok) attribution += 1;
      else
        failures.push({
          number: exp.number,
          field: 'material',
          detail: `expected=${exp.materialKey ?? '-'}#${exp.order ?? '-'} actual=${act?.materialKey ?? '-'}#${act?.order ?? '-'}`,
        });
    }

    for (const key of ['stem', ...OPTION_KEYS, 'answer', 'analysis']) {
      const { total, hit, extra: more } = formulaHits(exp[key], act?.[key]);
      formulaTotal += total;
      formulaHit += hit;
      formulaExtra += more;
      if (hit < total || more) failures.push({ number: exp.number, field: `formula:${key}`, detail: act?.[key] ?? '' });
    }
  }

  let materialBody = 0;
  let materialTable = 0;
  let materialTableTotal = 0;
  for (const m of expected.materials) {
    const key = materialMap.get(m.materialKey);
    const act = extracted.materials.find((x) => x.materialKey === key);
    const want = splitMaterial(`${m.stem}\n${m.material}`);
    const have = splitMaterial(act ? `${act.stem ?? ''}\n${act.material ?? ''}` : '');
    if (act && want.body === have.body) materialBody += 1;
    else failures.push({ number: m.materialKey, field: 'material:body', detail: act?.material ?? '' });
    if (want.table !== '[]') {
      materialTableTotal += 1;
      if (want.table === have.table) materialTable += 1;
      else failures.push({ number: m.materialKey, field: 'material:table', detail: act?.material ?? '' });
    }
  }

  return {
    questions: { expected: expected.questions.length, extracted: extracted.questions.length, extra: extra.length },
    materials: { expected: expected.materials.length, extracted: extracted.materials.length },
    split: rate(split, expected.questions.length),
    stemExact: rate(stemExact, expected.questions.length),
    type: rate(typeOk, expected.questions.length),
    options: rate(options, optionTotal),
    answers: rate(answers, answerTotal),
    formulas: { ...rate(formulaHit, formulaTotal), extra: formulaExtra },
    images: rate(imagesOk, imageTotal),
    materialBody: rate(materialBody, expected.materials.length),
    materialTable: rate(materialTable, materialTableTotal),
    attribution: hasMaterials ? rate(attribution, expected.questions.length) : rate(0, 0),
    answerConflicts: extracted.answerConflicts ?? 0,
    failures,
  };
}
