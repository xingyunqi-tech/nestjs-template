const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const TEXT_SYMBOLS = {
  '∞': '\\infty',
  '→': '\\to',
  '←': '\\leftarrow',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
  π: '\\pi',
  α: '\\alpha',
  β: '\\beta',
  γ: '\\gamma',
  δ: '\\delta',
  Δ: '\\Delta',
  ε: '\\varepsilon',
  θ: '\\theta',
  λ: '\\lambda',
  μ: '\\mu',
  σ: '\\sigma',
  φ: '\\varphi',
  ω: '\\omega',
  Ω: '\\Omega',
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\ne',
  '≈': '\\approx',
  '±': '\\pm',
  '×': '\\times',
  '÷': '\\div',
  '·': '\\cdot',
  '∈': '\\in',
  '∉': '\\notin',
  '⊂': '\\subset',
  '⊆': '\\subseteq',
  '∪': '\\cup',
  '∩': '\\cap',
  '∅': '\\varnothing',
  '∀': '\\forall',
  '∃': '\\exists',
  '∂': '\\partial',
  '∇': '\\nabla',
  '⋯': '\\cdots',
  '…': '\\ldots',
  '′': "'",
  '″': "''",
};

const FUNCTION_NAMES = [
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'ln',
  'lg',
  'log',
  'exp',
  'lim',
  'max',
  'min',
  'sup',
  'inf',
  'det',
];
const FUNCTION_RE = new RegExp(`(?<![A-Za-z\\\\])(${FUNCTION_NAMES.join('|')})(?![A-Za-z])`, 'g');

const NARY = {
  '∫': '\\int',
  '∬': '\\iint',
  '∭': '\\iiint',
  '∮': '\\oint',
  '∑': '\\sum',
  '∏': '\\prod',
  '∐': '\\coprod',
  '⋃': '\\bigcup',
  '⋂': '\\bigcap',
};

const ACCENTS = {
  '̂': '\\hat',
  '^': '\\hat',
  '̄': '\\bar',
  '̅': '\\bar',
  '¯': '\\bar',
  '̇': '\\dot',
  '̈': '\\ddot',
  '⃗': '\\vec',
  '→': '\\vec',
  '̃': '\\tilde',
  '~': '\\tilde',
};

const BRACES = { '⏞': 'top', '⏟': 'bot', '︷': 'top', '︸': 'bot' };

const ARROWS = {
  '→': ['\\xrightarrow', '\\overrightarrow', '\\underrightarrow'],
  '←': ['\\xleftarrow', '\\overleftarrow', '\\underleftarrow'],
  '↔': ['\\xleftrightarrow', '\\overleftrightarrow', '\\underleftrightarrow'],
  '⇒': ['\\xRightarrow', '\\overset{\\Rightarrow}', '\\underset{\\Rightarrow}'],
  '⇐': ['\\xLeftarrow', '\\overset{\\Leftarrow}', '\\underset{\\Leftarrow}'],
  '⇔': ['\\xLeftrightarrow', '\\overset{\\Leftrightarrow}', '\\underset{\\Leftrightarrow}'],
};

const IGNORED_W = new Set(['bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd']);

const DELIMITERS = {
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '{': '\\{',
  '}': '\\}',
  '|': '|',
  '‖': '\\|',
  '⟨': '\\langle',
  '⟩': '\\rangle',
  '⌊': '\\lfloor',
  '⌋': '\\rfloor',
  '⌈': '\\lceil',
  '⌉': '\\rceil',
  '': '.',
};

function elements(node) {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) out.push(c);
  }
  return out;
}

function child(node, name) {
  if (!node) return null;
  return elements(node).find((c) => c.namespaceURI === M_NS && c.localName === name) ?? null;
}

function prop(node, prName, name) {
  const pr = child(node, prName);
  const el = child(pr, name);
  if (!el) return undefined;
  if (el.hasAttributeNS(M_NS, 'val')) return el.getAttributeNS(M_NS, 'val');
  return el.hasAttribute('m:val') ? el.getAttribute('m:val') : 'on';
}

function isOn(value) {
  return value !== undefined && value !== '0' && value !== 'off' && value !== 'false';
}

function textOf(node) {
  let out = '';
  for (const c of elements(node)) {
    if (c.localName === 't') out += c.textContent;
    else if (c.localName === 'tab') out += ' ';
  }
  return out;
}

export function convertText(text) {
  let out = '';
  for (const ch of text) out += TEXT_SYMBOLS[ch] ? `${TEXT_SYMBOLS[ch]} ` : ch;
  return out.replace(FUNCTION_RE, '\\$1 ');
}

function tidy(latex) {
  return latex
    .replace(/\s+/g, ' ')
    .replace(/([{^_]) /g, '$1')
    .replace(/ ([}^_])/g, '$1')
    .trim();
}

function group(s) {
  return `{${s}}`;
}

function latexTokens(latex) {
  return [...latex.matchAll(/\\[A-Za-z]+|\\.|\s+|./gsu)].map((m) => m[0]).filter((t) => !/^\s+$/.test(t));
}

function closesAtEnd(tokens, open, close) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === open) depth += 1;
    else if (tokens[i] === close) depth -= 1;
    if (depth === 0) return open === '\\left' ? i === tokens.length - 2 : i === tokens.length - 1;
  }
  return false;
}

export function isAtom(latex) {
  const tokens = latexTokens(latex);
  if (tokens.length === 1) return true;
  if (tokens[0] === '{') return closesAtEnd(tokens, '{', '}');
  if (tokens[0] === '\\left') return closesAtEnd(tokens, '\\left', '\\right');
  return false;
}

function isDeleted(run) {
  const rPr = elements(run).find((c) => c.namespaceURI === W_NS && c.localName === 'rPr');
  return Boolean(rPr && elements(rPr).some((c) => c.namespaceURI === W_NS && c.localName === 'del'));
}

export class OmmlConverter {
  constructor() {
    this.unknown = new Map();
  }

  convert(oMath) {
    return tidy(this.children(oMath));
  }

  children(node) {
    if (!node) return '';
    return elements(node)
      .map((c) => this.node(c))
      .join('');
  }

  arg(node, name) {
    return tidy(this.children(child(node, name)));
  }

  count(key) {
    this.unknown.set(key, (this.unknown.get(key) ?? 0) + 1);
  }

  node(el) {
    const name = el.localName;
    if (el.namespaceURI === W_NS) {
      if (name === 'r') return isDeleted(el) ? '' : convertText(textOf(el));
      if (name === 'ins' || name === 'moveTo' || name === 'smartTag' || name === 'customXml') return this.children(el);
      if (name === 'del' || name === 'moveFrom' || name.endsWith('Pr') || IGNORED_W.has(name)) return '';
      this.count(`w:${name}`);
      return '';
    }
    if (el.namespaceURI !== M_NS) {
      this.count(el.prefix ? `${el.prefix}:${name}` : name);
      return '';
    }
    if (name.endsWith('Pr')) return '';
    switch (name) {
      case 'oMath':
      case 'e':
      case 'num':
      case 'den':
      case 'sub':
      case 'sup':
      case 'deg':
      case 'lim':
      case 'fName':
      case 'box':
        return this.children(el);
      case 'r':
        return isDeleted(el) ? '' : convertText(textOf(el));
      case 'f':
        return this.fraction(el);
      case 'sSup':
        return `${this.base(el)}^${group(this.arg(el, 'sup'))}`;
      case 'sSub':
        return `${this.base(el)}_${group(this.arg(el, 'sub'))}`;
      case 'sSubSup':
        return `${this.base(el)}_${group(this.arg(el, 'sub'))}^${group(this.arg(el, 'sup'))}`;
      case 'sPre':
        return `{}_${group(this.arg(el, 'sub'))}^${group(this.arg(el, 'sup'))}${this.base(el)}`;
      case 'rad':
        return this.radical(el);
      case 'nary':
        return this.nary(el);
      case 'func':
        return `${this.arg(el, 'fName')} ${this.arg(el, 'e')}`;
      case 'limLow':
        return this.limit(el, '_', '\\underset');
      case 'limUpp':
        return this.limit(el, '^', '\\overset');
      case 'd':
        return this.delimiter(el);
      case 'acc': {
        const chr = prop(el, 'accPr', 'chr') ?? '̂';
        return `${ACCENTS[chr] ?? '\\hat'}${group(this.arg(el, 'e'))} `;
      }
      case 'bar':
        return `${prop(el, 'barPr', 'pos') === 'top' ? '\\overline' : '\\underline'}${group(this.arg(el, 'e'))}`;
      case 'groupChr':
        return this.groupChr(el);
      case 'borderBox':
        return `\\boxed${group(this.arg(el, 'e'))}`;
      case 'eqArr':
        return `\\begin{aligned}${elements(el)
          .filter((c) => c.localName === 'e')
          .map((c) => tidy(this.children(c)))
          .join('\\\\')}\\end{aligned}`;
      case 'm':
        return this.matrix(el);
      default:
        this.count(`m:${name}`);
        return `\\text{[?m:${name}]}`;
    }
  }

  base(el) {
    const base = this.arg(el, 'e');
    return isAtom(base) ? base : group(base);
  }

  groupChr(el) {
    const body = this.arg(el, 'e');
    const chr = prop(el, 'groupChrPr', 'chr') ?? '⏟';
    const pos = prop(el, 'groupChrPr', 'pos') ?? 'bot';
    if (BRACES[chr]) return `${pos === 'top' ? '\\overbrace' : '\\underbrace'}${group(body)}`;
    const arrow = ARROWS[chr];
    if (arrow) return `${pos === 'bot' ? arrow[0] : arrow[1]}${group(body)}`;
    const symbol = convertText(chr).trim();
    return `${pos === 'top' ? '\\overset' : '\\underset'}${group(symbol)}${group(body)}`;
  }

  fraction(el) {
    const num = this.arg(el, 'num');
    const den = this.arg(el, 'den');
    const type = prop(el, 'fPr', 'type');
    const linear = (s) =>
      /^(\d+(\.\d+)?|[A-Za-z]|\\[A-Za-z]+)$/.test(s) || (/^\\left/.test(s) && isAtom(s)) ? s : `(${s})`;
    if (type === 'lin' || type === 'skw') return `${linear(num)}/${linear(den)}`;
    if (type === 'noBar') return `\\genfrac{}{}{0pt}{}${group(num)}${group(den)}`;
    return `\\frac${group(num)}${group(den)}`;
  }

  radical(el) {
    const deg = this.arg(el, 'deg');
    const body = group(this.arg(el, 'e'));
    if (isOn(prop(el, 'radPr', 'degHide')) || !deg) return `\\sqrt${body}`;
    return `\\sqrt[${deg}]${body}`;
  }

  nary(el) {
    const chr = prop(el, 'naryPr', 'chr') || '∫';
    const op = NARY[chr] ?? convertText(chr).trim();
    const lo = isOn(prop(el, 'naryPr', 'subHide')) ? '' : this.arg(el, 'sub');
    const hi = isOn(prop(el, 'naryPr', 'supHide')) ? '' : this.arg(el, 'sup');
    const limits = `${lo ? `_${group(lo)}` : ''}${hi ? `^${group(hi)}` : ''}`;
    return `${op}${limits} ${this.arg(el, 'e')}`;
  }

  limit(el, mark, command) {
    const body = this.arg(el, 'e');
    const lim = this.arg(el, 'lim');
    const brace = body.match(/^\\(?:underbrace|overbrace)(?=\{)/);
    if (/^\\[A-Za-z]+$/.test(body) || (brace && isAtom(body.slice(brace[0].length)))) {
      return `${body}${mark}${group(lim)}`;
    }
    return `${command}${group(lim)}${group(body)}`;
  }

  delimiter(el) {
    const beg = prop(el, 'dPr', 'begChr') ?? '(';
    const end = prop(el, 'dPr', 'endChr') ?? ')';
    const sep = prop(el, 'dPr', 'sepChr') ?? '|';
    const items = elements(el)
      .filter((c) => c.localName === 'e')
      .map((c) => tidy(this.children(c)));
    const open = DELIMITERS[beg] ?? beg;
    const close = DELIMITERS[end] ?? end;
    return `\\left${open}${items.join(sep)}\\right${close}`;
  }

  matrix(el) {
    const rows = elements(el)
      .filter((c) => c.localName === 'mr')
      .map((mr) =>
        elements(mr)
          .filter((c) => c.localName === 'e')
          .map((c) => tidy(this.children(c)))
          .join('&'),
      );
    return `\\begin{matrix}${rows.join('\\\\')}\\end{matrix}`;
  }
}
