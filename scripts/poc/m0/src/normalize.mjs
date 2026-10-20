import { convertText } from './omml.mjs';

const BRACED_ARGS = { '\\frac': 2, '\\dfrac': 2, '\\tfrac': 2, '\\binom': 2, '\\sqrt': 1, '^': 1, _: 1 };
const COMMAND_ALIASES = {
  '\\dfrac': '\\frac',
  '\\tfrac': '\\frac',
  '\\leq': '\\le',
  '\\geq': '\\ge',
  '\\neq': '\\ne',
  '\\epsilon': '\\varepsilon',
  '\\phi': '\\varphi',
  '\\rightarrow': '\\to',
  '\\emptyset': '\\varnothing',
};

function unifyChars(text) {
  return text
    .normalize('NFKC')
    .replace(/[−‐‑‒–﹣－]/g, '-')
    .replace(/[“”„″]/g, '"')
    .replace(/[‘’′]/g, "'");
}

function tokenize(latex) {
  const tokens = [];
  const re = /\\[A-Za-z]+|\\.|\s+|./gsu;
  for (const [tok] of latex.matchAll(re)) {
    if (/^\s+$/.test(tok)) continue;
    tokens.push(COMMAND_ALIASES[tok] ?? tok);
  }
  return tokens;
}

function joinTokens(pieces) {
  let out = '';
  for (const piece of pieces) {
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(piece)) out += ' ';
    out += piece;
  }
  return out;
}

function canonical(tokens) {
  let i = 0;
  const readGroup = () => {
    const out = [];
    let depth = 1;
    i += 1;
    while (i < tokens.length && depth > 0) {
      if (tokens[i] === '{') depth += 1;
      if (tokens[i] === '}') depth -= 1;
      if (depth > 0) out.push(tokens[i]);
      i += 1;
    }
    return out;
  };
  const readArg = () => {
    if (tokens[i] === '{') return canonical(readGroup());
    const tok = tokens[i];
    i += 1;
    return tok === undefined ? '' : canonical([tok]);
  };
  const out = [];
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === '\\left' || tok === '\\right') {
      i += 1;
      continue;
    }
    const arity = BRACED_ARGS[tok];
    if (arity) {
      i += 1;
      out.push(tok);
      if (tok === '\\sqrt' && tokens[i] === '[') {
        const deg = [];
        i += 1;
        while (i < tokens.length && tokens[i] !== ']') deg.push(tokens[i++]);
        i += 1;
        out.push(`[${canonical(deg)}]`);
      }
      for (let k = 0; k < arity; k += 1) out.push(`{${readArg()}}`);
      continue;
    }
    if (tok === '{') {
      const inner = readGroup();
      out.push(inner.length === 1 ? canonical(inner) : `{${canonical(inner)}}`);
      continue;
    }
    out.push(tok);
    i += 1;
  }
  return joinTokens(out);
}

export function normalizeLatex(latex) {
  return canonical(tokenize(convertText(unifyChars(latex))));
}

export function extractFormulas(text) {
  return [...String(text ?? '').matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
}

export function normalizeText(text) {
  return unifyChars(String(text ?? ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '![img]')
    .replace(/\$([^$]+)\$/g, (_, f) => `$${normalizeLatex(f)}$`)
    .replace(/[\s　]+/g, '')
    .replace(/[。.]$/, '');
}

function splitOutsideMath(text, sep) {
  const parts = [''];
  let inMath = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$') inMath = !inMath;
    if (!inMath && text.startsWith(sep, i)) {
      parts.push('');
      i += sep.length - 1;
      continue;
    }
    parts[parts.length - 1] += text[i];
  }
  return parts;
}

function choiceLetters(text) {
  const upper = text.toUpperCase();
  if (/^[A-H]+$/.test(upper)) return [...upper];
  if (/^[A-H](?:[,，、;；]+[A-H])+$/.test(upper)) return upper.split(/[,，、;；]+/);
  return null;
}

export function normalizeAnswer(answer, type) {
  const text = normalizeText(answer);
  if (type === 'SINGLE' || type === 'MULTIPLE') {
    const letters = choiceLetters(text);
    return letters ? [...new Set(letters)].sort().join('') : `?${text}`;
  }
  if (type === 'JUDGE') {
    if (/^(对|正确|√|T|TRUE|是)$/i.test(text)) return '对';
    if (/^(错|错误|×|X|F|FALSE|否)$/i.test(text)) return '错';
    return text;
  }
  if (type === 'FILL') {
    return splitOutsideMath(text, '||')
      .map((blank) => splitOutsideMath(blank, '|').filter(Boolean).sort().join('|'))
      .join('||');
  }
  return text;
}
