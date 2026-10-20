const NUMBER_LINE = /^(\d{1,3})\s*(?:[．、]|\.(?!\d))/;
const TABLE_NUMBER_ROW = /^\|\s*(\d{1,3})\s*\|/;
const RANGE_LINE = /^(\d{1,3})\s*[—\-–~～至到]\s*\d{1,3}\s*[：:]/;
const ANSWER_HEADING = /^(参考)?答案(与|及|和)?(解析|详解)?[:：]?$/;
const MATERIAL_INTRO = /回答\s*(?:第\s*)?(\d{1,3})\s*[～~\-—–至到]\s*(\d{1,3})\s*题/;

export function splitAnswerArea(text) {
  const lines = text.split('\n');
  let seenQuestion = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (NUMBER_LINE.test(line)) seenQuestion = true;
    if (seenQuestion && ANSWER_HEADING.test(line.replace(/\s/g, ''))) {
      return { questions: lines.slice(0, i).join('\n'), answers: lines.slice(i).join('\n') };
    }
  }
  return { questions: text, answers: '' };
}

export function questionUnits(text) {
  const lines = text.split('\n');
  const starts = [];
  let next = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].trim().match(NUMBER_LINE);
    if (!m) continue;
    const n = Number(m[1]);
    if (next === null || n === next) {
      starts.push({ number: n, line: i });
      next = n + 1;
    }
  }

  const materials = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(MATERIAL_INTRO);
    if (m) materials.push({ line: i, from: Number(m[1]), to: Number(m[2]) });
  }
  for (const mat of materials) {
    const target = starts.find((s) => s.number === mat.from);
    if (target && mat.line < target.line) target.line = mat.line;
  }

  const units = starts.map((s, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].line : lines.length;
    const begin = idx === 0 ? 0 : s.line;
    return { number: s.number, text: lines.slice(begin, end).join('\n').trim() };
  });
  return { units, materials };
}

export function chunkUnits(units, materials, size) {
  const chunks = [];
  let current = [];
  for (const unit of units) {
    current.push(unit);
    if (current.length < size) continue;
    const inside = materials.find((m) => unit.number >= m.from && unit.number < m.to);
    if (inside) continue;
    chunks.push(current);
    current = [];
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function answerChunks(text, size) {
  const lines = text.split('\n');
  const entries = [];
  let next = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const m = line.match(NUMBER_LINE) ?? line.match(TABLE_NUMBER_ROW) ?? line.match(RANGE_LINE);
    if (!m) continue;
    const n = Number(m[1]);
    if (next === null || n >= next) {
      entries.push(i);
      next = n + 1;
    }
  }
  if (!entries.length) return text.trim() ? [{ header: '', entries: [text.trim()] }] : [];

  const header = lines.slice(0, entries[0]).join('\n').trim();
  const pieces = entries.map((start, idx) => lines.slice(start, entries[idx + 1] ?? lines.length).join('\n'));
  const isRange = RANGE_LINE.test(lines[entries[0]].trim());
  const perChunk = isRange ? Math.max(1, Math.floor(size / 5)) : size;
  const chunks = [];
  for (let i = 0; i < pieces.length; i += perChunk) {
    chunks.push({ header, entries: pieces.slice(i, i + perChunk) });
  }
  return chunks;
}
