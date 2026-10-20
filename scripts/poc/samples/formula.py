"""公式节点：同一份定义同时输出 Word OMML 与 LaTeX"""

import re
from dataclasses import dataclass
from xml.sax.saxutils import escape

M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'


@dataclass
class F:
    kind: str
    args: tuple

    def latex(self) -> str:
        return _latex(self)

    def omml(self) -> str:
        return f'<m:oMath xmlns:m="{M_NS}">{_omml(self)}</m:oMath>'


def t(text):
    return F('text', (text,))


def seq(*items):
    return F('seq', items)


def frac(num, den):
    return F('frac', (num, den))


def sup(base, exp):
    return F('sup', (base, exp))


def sub(base, idx):
    return F('sub', (base, idx))


def sqrt(body, deg=None):
    return F('sqrt', (body, deg))


def integral(lo, hi, body):
    return F('int', (lo, hi, body))


def summation(lo, hi, body):
    return F('sum', (lo, hi, body))


def lim(under, body):
    return F('lim', (under, body))


def paren(body):
    return F('paren', (body,))


LATEX_SYMBOLS = {'∞': r'\infty', '→': r'\to', 'π': r'\pi'}


def _node(x):
    return x if isinstance(x, F) else t(x)


def _latex_text(text):
    for sym, cmd in LATEX_SYMBOLS.items():
        text = text.replace(sym, f'{cmd} ')
    for fn in ('sin', 'cos', 'ln'):
        text = text.replace(fn, f'\\{fn} ')
    return re.sub(r'\s+', ' ', text).strip()


def _latex(node) -> str:
    node = _node(node)
    k, a = node.kind, node.args
    if k == 'text':
        return _latex_text(a[0])
    if k == 'seq':
        return ''.join(_latex(x) for x in a)
    if k == 'frac':
        return rf'\frac{{{_latex(a[0])}}}{{{_latex(a[1])}}}'
    if k == 'sup':
        return f'{_latex(a[0])}^{{{_latex(a[1])}}}'
    if k == 'sub':
        return f'{_latex(a[0])}_{{{_latex(a[1])}}}'
    if k == 'sqrt':
        deg = f'[{_latex(a[1])}]' if a[1] is not None else ''
        return rf'\sqrt{deg}{{{_latex(a[0])}}}'
    if k == 'int':
        if a[0] == '' and a[1] == '':
            return rf'\int {_latex(a[2])}'
        return rf'\int_{{{_latex(a[0])}}}^{{{_latex(a[1])}}} {_latex(a[2])}'
    if k == 'sum':
        return rf'\sum_{{{_latex(a[0])}}}^{{{_latex(a[1])}}} {_latex(a[2])}'
    if k == 'lim':
        return rf'\lim_{{{_latex(a[0])}}} {_latex(a[1])}'
    if k == 'paren':
        return rf'\left({_latex(a[0])}\right)'
    raise ValueError(k)


def _r(text):
    return f'<m:r><m:t xml:space="preserve">{escape(text)}</m:t></m:r>'


def _e(tag, node):
    return f'<m:{tag}>{_omml(node)}</m:{tag}>'


def _nary(chr_, lo, hi, body):
    if lo == '' and hi == '':
        return (
            f'<m:nary><m:naryPr><m:chr m:val="{chr_}"/><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr>'
            f'<m:sub/><m:sup/>{_e("e", body)}</m:nary>'
        )
    return (
        f'<m:nary><m:naryPr><m:chr m:val="{chr_}"/></m:naryPr>'
        f'{_e("sub", lo)}{_e("sup", hi)}{_e("e", body)}</m:nary>'
    )


def _omml(node) -> str:
    node = _node(node)
    k, a = node.kind, node.args
    if k == 'text':
        return _r(a[0])
    if k == 'seq':
        return ''.join(_omml(x) for x in a)
    if k == 'frac':
        return f'<m:f>{_e("num", a[0])}{_e("den", a[1])}</m:f>'
    if k == 'sup':
        return f'<m:sSup>{_e("e", a[0])}{_e("sup", a[1])}</m:sSup>'
    if k == 'sub':
        return f'<m:sSub>{_e("e", a[0])}{_e("sub", a[1])}</m:sSub>'
    if k == 'sqrt':
        if a[1] is None:
            return f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>{_e("e", a[0])}</m:rad>'
        return f'<m:rad>{_e("deg", a[1])}{_e("e", a[0])}</m:rad>'
    if k == 'int':
        return _nary('∫', *a)
    if k == 'sum':
        return _nary('∑', *a)
    if k == 'lim':
        return (
            f'<m:func><m:fName><m:limLow>{_e("e", "lim")}{_e("lim", a[0])}</m:limLow></m:fName>'
            f'{_e("e", a[1])}</m:func>'
        )
    if k == 'paren':
        return f'<m:d>{_e("e", a[0])}</m:d>'
    raise ValueError(k)


def plain(segments) -> str:
    """把「文本 + 公式」片段列表转成带 $...$ 的期望文本"""
    if isinstance(segments, str):
        return segments
    return ''.join(s if isinstance(s, str) else f'${s.latex()}$' for s in segments)
