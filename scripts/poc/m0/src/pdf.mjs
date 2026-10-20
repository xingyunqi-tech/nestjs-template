import { readFile } from 'node:fs/promises';
import { getDocumentProxy } from 'unpdf';

export const SCANNED_MIN_CHARS = 50;
const EDGE_LINES = 2;
const REPEAT_Y_TOLERANCE = 3;
const GAP_REGION = [0.3, 0.7];
const GAP_NOISE = 0.02;
const GAP_MIN_WIDTH = 6;

const BLOCK_START = [
  /^\d{1,3}\s*[．.、]/,
  /^[A-H]\s*[．.、]/,
  /^[一二三四五六七八九十]+\s*[、．.]/,
  /^【/,
  /^(参考)?答案/,
  /^\d{1,3}\s*[—\-–~～]\s*\d{1,3}\s*[：:]/,
  /^(根据|阅读)以下/,
];

const PAGE_NUMBER = /^[\s—\-–]*(第\s*)?\d+(\s*页)?[\s—\-–]*$|^\d+\s*\/\s*\d+$/;

function countChars(text) {
  return text.replace(/\s/g, '').length;
}

function toLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - item.y) <= Math.max(2, item.h * 0.4)) {
      last.items.push(item);
    } else {
      lines.push({ y: item.y, h: item.h, items: [item] });
    }
  }
  return lines.map((line) => {
    const parts = line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const p of parts) {
      if (end !== null && p.x - end > p.h * 0.5 && !text.endsWith(' ')) text += ' ';
      text += p.str;
      end = p.x + p.w;
    }
    return { y: line.y, h: line.h, x: parts[0].x, items: parts, text: text.trim() };
  });
}

function edgeCandidates(lines) {
  const visible = lines.filter((l) => l.text);
  const top = visible.slice(0, EDGE_LINES);
  const bottom = visible.slice(-EDGE_LINES).filter((l) => !top.includes(l));
  return [
    ...top.map((l, i) => ({ ...l, outer: i === 0 })),
    ...bottom.map((l, i) => ({ ...l, outer: i === bottom.length - 1 })),
  ];
}

function findGap(items, width) {
  const bins = new Array(Math.ceil(width) + 1).fill(0);
  for (const i of items) {
    for (let x = Math.max(0, Math.floor(i.x)); x <= Math.min(bins.length - 1, Math.ceil(i.x + i.w)); x += 1)
      bins[x] += 1;
  }
  const allowed = Math.max(1, Math.floor(items.length * GAP_NOISE));
  let best = null;
  let runStart = null;
  const from = Math.floor(width * GAP_REGION[0]);
  const to = Math.ceil(width * GAP_REGION[1]);
  for (let x = from; x <= to + 1; x += 1) {
    const empty = x <= to && bins[x] <= allowed;
    if (empty && runStart === null) runStart = x;
    if (!empty && runStart !== null) {
      if (!best || x - runStart > best.end - best.start) best = { start: runStart, end: x };
      runStart = null;
    }
  }
  return best && best.end - best.start >= GAP_MIN_WIDTH ? best : null;
}

function splitColumns(items, width) {
  const visible = items.filter((i) => i.str.trim());
  const gap = findGap(visible, width);
  if (!gap) return { columns: [items], twoColumn: false };
  const split = (gap.start + gap.end) / 2;
  const left = items.filter((i) => i.x + i.w <= split);
  const right = items.filter((i) => i.x >= split);
  const full = items.filter((i) => i.x < split && i.x + i.w > split);
  const minSide = Math.max(3, visible.length * 0.1);
  if (left.length < minSide || right.length < minSide) return { columns: [items], twoColumn: false };
  const columnTop = Math.max(...[...left, ...right].map((i) => i.y));
  return {
    columns: [full.filter((i) => i.y > columnTop), left, right, full.filter((i) => i.y <= columnTop)].filter(
      (c) => c.length,
    ),
    twoColumn: true,
    gap: [Math.round(gap.start), Math.round(gap.end)],
  };
}

function joinLines(lines) {
  const out = [];
  for (const line of lines) {
    const prev = out.at(-1);
    if (!prev || BLOCK_START.some((re) => re.test(line))) {
      out.push(line);
      continue;
    }
    const glue = /[\x21-\x7e]$/.test(prev) && /^[\x21-\x7e]/.test(line) ? ' ' : '';
    out[out.length - 1] = prev + glue + line;
  }
  return out;
}

function normalizeRepeat(text) {
  return text.replace(/\d+/g, '#').replace(/\s/g, '');
}

function isLowText(chars) {
  return chars < SCANNED_MIN_CHARS;
}

export function judgeScanned(pages) {
  const lowTextPages = pages.filter((p) => isLowText(p.chars)).map((p) => p.page);
  return { lowTextPages, scanned: pages.length > 0 && lowTextPages.length === pages.length };
}

export async function parsePdf(file) {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(file)));
  const raw = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => typeof i.str === 'string' && i.str !== '')
      .map((i) => ({
        str: i.str,
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        h: Math.abs(i.transform[3]) || i.height || 10,
      }));
    const lines = toLines(items);
    raw.push({ n, width, height, items, edges: edgeCandidates(lines) });
  }

  const removed = [];
  const pages = [];
  for (const p of raw) {
    const dropped = new Set();
    for (const edge of p.edges) {
      const key = normalizeRepeat(edge.text);
      const repeats = raw.filter(
        (o) =>
          o !== p &&
          o.edges.some((e) => normalizeRepeat(e.text) === key && Math.abs(e.y - edge.y) <= REPEAT_Y_TOLERANCE),
      ).length;
      const pageNumber = edge.outer && PAGE_NUMBER.test(edge.text);
      if (repeats > 0 || pageNumber) {
        removed.push(`p${p.n}: ${edge.text}`);
        for (const item of edge.items) dropped.add(item);
      }
    }
    const body = p.items.filter((i) => !dropped.has(i));
    const { columns, twoColumn, gap } = splitColumns(body, p.width);
    pages.push({
      page: p.n,
      chars: countChars(body.map((i) => i.str).join('')),
      twoColumn,
      gap,
      lines: columns.flatMap((c) => toLines(c).map((l) => l.text)),
    });
  }

  const { lowTextPages, scanned } = judgeScanned(pages);
  return {
    text: joinLines(pages.flatMap((p) => p.lines)).join('\n'),
    pages: pages.map((p) => ({
      page: p.page,
      chars: p.chars,
      lowText: isLowText(p.chars),
      twoColumn: p.twoColumn,
      ...(p.gap ? { columnGap: p.gap } : {}),
    })),
    lowTextPages,
    scanned,
    removedHeaderFooter: removed,
  };
}
