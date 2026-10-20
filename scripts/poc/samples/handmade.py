"""s7：按 Word 实际输出风格手写的 OMML 公式与题目"""

from xml.sax.saxutils import escape

from formula import M_NS

W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W_RPR = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr>'
CTRL = f'<m:ctrlPr>{W_RPR}</m:ctrlPr>'
REVISION = 'w:author="审校" w:date="2026-10-01T09:00:00Z"'


class Raw:
    """手写 OMML 片段与其期望 LaTeX"""

    def __init__(self, xml, latex, para=False):
        self.xml = xml
        self._latex = latex
        self.para = para

    def latex(self):
        return self._latex

    def omml(self):
        ns = f'xmlns:m="{M_NS}" xmlns:w="{W_NS}"'
        if self.para:
            return (
                f'<m:oMathPara {ns}><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>'
                f'<m:oMath>{self.xml}</m:oMath></m:oMathPara>'
            )
        return f'<m:oMath {ns}>{self.xml}</m:oMath>'


def r(text, upright=False):
    rpr = '<m:rPr><m:sty m:val="p"/></m:rPr>' if upright else ''
    return f'<m:r>{rpr}{W_RPR}<m:t xml:space="preserve">{escape(text)}</m:t></m:r>'


def runs(*parts):
    return ''.join(r(p) for p in parts)


def e(inner, tag='e'):
    return f'<m:{tag}><m:argPr><m:argSz m:val="0"/></m:argPr>{inner}</m:{tag}>' if tag == 'e' else f'<m:{tag}>{inner}</m:{tag}>'


def ssubsup(base, sub_, sup_):
    return f'<m:sSubSup><m:sSubSupPr>{CTRL}</m:sSubSupPr>{e(r(base))}{e(r(sub_), "sub")}{e(r(sup_), "sup")}</m:sSubSup>'


def ssub(base, sub_):
    return f'<m:sSub><m:sSubPr>{CTRL}</m:sSubPr>{e(r(base))}{e(r(sub_), "sub")}</m:sSub>'


def ssup(base_xml, sup_):
    return f'<m:sSup><m:sSupPr>{CTRL}</m:sSupPr>{e(base_xml)}{e(r(sup_), "sup")}</m:sSup>'


def vec(letter):
    return f'<m:acc><m:accPr><m:chr m:val="⃗"/>{CTRL}</m:accPr>{e(r(letter))}</m:acc>'


def paren(inner, beg=None, end=None):
    chars = ''
    if beg is not None:
        chars += f'<m:begChr m:val="{escape(beg)}"/>'
    if end is not None:
        chars += f'<m:endChr m:val="{escape(end)}"/>'
    return f'<m:d><m:dPr>{chars}{CTRL}</m:dPr>{e(inner)}</m:d>'


def func(name_xml, body_xml):
    return f'<m:func><m:funcPr>{CTRL}</m:funcPr><m:fName>{name_xml}</m:fName>{e(body_xml)}</m:func>'


def frac(num_xml, den_xml, linear=False):
    kind = '<m:type m:val="lin"/>' if linear else ''
    return f'<m:f><m:fPr>{kind}{CTRL}</m:fPr>{e(num_xml, "num")}{e(den_xml, "den")}</m:f>'


def matrix(rows):
    cols = len(rows[0])
    mpr = (
        f'<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="{cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>'
        f'{CTRL}</m:mPr>'
    )
    body = ''.join('<m:mr>' + ''.join(e(r(c)) for c in row) + '</m:mr>' for row in rows)
    return f'<m:m>{mpr}{body}</m:m>'


def eq_arr(*lines):
    return f'<m:eqArr><m:eqArrPr>{CTRL}</m:eqArrPr>' + ''.join(e(r(line)) for line in lines) + '</m:eqArr>'


def bar(letter):
    return f'<m:bar><m:barPr><m:pos m:val="top"/>{CTRL}</m:barPr>{e(r(letter))}</m:bar>'


def box(inner):
    return f'<m:box><m:boxPr><m:opEmu m:val="1"/>{CTRL}</m:boxPr>{e(inner)}</m:box>'


def group_chr(inner, chr_=None, pos=None, vert=None):
    pr = ''
    if chr_ is not None:
        pr += f'<m:chr m:val="{chr_}"/>'
    if pos is not None:
        pr += f'<m:pos m:val="{pos}"/>'
    if vert is not None:
        pr += f'<m:vertJc m:val="{vert}"/>'
    return f'<m:groupChr><m:groupChrPr>{pr}{CTRL}</m:groupChrPr>{e(inner)}</m:groupChr>'


def lim_low(body_xml, lim_xml):
    return f'<m:limLow><m:limLowPr>{CTRL}</m:limLowPr>{e(body_xml)}{e(lim_xml, "lim")}</m:limLow>'


def nary_int(lo, hi, body_xml):
    return (
        f'<m:nary><m:naryPr><m:limLoc m:val="subSup"/>{CTRL}</m:naryPr>'
        f'{e(r(lo), "sub")}{e(r(hi), "sup")}{e(body_xml)}</m:nary>'
    )


def ins(inner, rid):
    return f'<w:ins w:id="{rid}" {REVISION}>{inner}</w:ins>'


def dele(inner, rid):
    return f'<w:del w:id="{rid}" {REVISION}>{inner}</w:del>'


def opts(*items):
    return list(zip('ABCD', items))


def q(key, type_, stem, options=None, answer='', analysis='', points=None):
    return {
        'key': key,
        'type': type_,
        'stem': stem,
        'options': options or [],
        'answer': answer,
        'analysis': analysis,
        'points': points or [],
    }


LIM_SIN = Raw(
    func(lim_low(r('lim', upright=True), r('x') + box(r('→')) + r('0')),
         frac(func(r('sin', upright=True), r('3x')), r('x'))),
    r'\lim_{x\to 0}\frac{\sin 3x}{x}',
)

S7_QUESTIONS = [
    q('s7-01', 'SINGLE',
      ['已知 ', Raw(ssubsup('a', '1', '2') + r('+') + ssubsup('a', '2', '2') + r('=5'), 'a_{1}^{2}+a_{2}^{2}=5'),
       '，', Raw(ssub('a', '1') + r('=1'), 'a_{1}=1'), '，且 ', Raw(ssub('a', '2') + r('>0'), 'a_{2}>0'),
       '，则 ', Raw(ssub('a', '2'), 'a_{2}'), ' 等于（　　）。'],
      opts('1', '2', '3', '4'), 'B',
      ['由 ', Raw(r('1+') + ssubsup('a', '2', '2') + r('=5'), '1+a_{2}^{2}=5'), ' 得 ',
       Raw(ssub('a', '2') + r('=2'), 'a_{2}=2'), '（负根舍去）。']),
    q('s7-02', 'SINGLE',
      ['已知向量 ', Raw(vec('a') + r('=') + paren(r('1,2')), r'\vec{a}=(1,2)'), '，',
       Raw(vec('b') + r('=') + paren(r('3,−1')), r'\vec{b}=(3,-1)'), '，则 ',
       Raw(vec('a') + r('·') + vec('b'), r'\vec{a}\cdot\vec{b}'), ' 等于（　　）。'],
      opts('1', '2', '5', '−1'), 'A',
      [Raw(vec('a') + r('·') + vec('b') + r('=1×3+2×') + paren(r('−1')) + r('=1'),
           r'\vec{a}\cdot\vec{b}=1\times3+2\times(-1)=1'), '。']),
    q('s7-03', 'SINGLE',
      ['设矩阵 ', Raw(r('A=') + paren(matrix([['1', '2'], ['3', '4']])),
                   r'A=\left(\begin{matrix}1&2\\3&4\end{matrix}\right)'),
       '，则 ', Raw(func(r('det', upright=True), r('A')), r'\det A'), ' 等于（　　）。'],
      opts('−2', '2', '10', '−10'), 'A',
      [Raw(func(r('det', upright=True), r('A')) + r('=1×4−2×3=−2'), r'\det A=1\times4-2\times3=-2'), '。']),
    q('s7-04', 'SINGLE',
      ['方程组 ', Raw(paren(eq_arr('x+y=3', 'x−y=1'), beg='{', end=''),
                    r'\left\{\begin{aligned}x+y=3\\x-y=1\end{aligned}\right.', para=True),
       ' 的解为（　　）。'],
      opts('x=2，y=1', 'x=1，y=2', 'x=3，y=0', 'x=0，y=3'), 'A', '两式相加得 2x=4。'),
    q('s7-05', 'FILL',
      [Raw(lim_low(group_chr(runs('2+2+', '⋯', '+2')), r('n')), r'\underbrace{2+2+\cdots+2}_{n}'),
       ' 的值为______。'],
      answer='2n', analysis='n 个 2 相加。'),
    q('s7-06', 'FILL',
      ['若 ', Raw(r('z=1+2') + r('i', upright=True), 'z=1+2i'), '，则 ',
       Raw(r('z·') + bar('z'), r'z\cdot\overline{z}'), ' 的值为______。'],
      answer='5',
      analysis=[Raw(r('z·') + bar('z') + r('=') + ssup(r('1'), '2') + r('+') + ssup(r('2'), '2') + r('=5'),
                    r'z\cdot\overline{z}=1^{2}+2^{2}=5'), '。']),
    q('s7-07', 'JUDGE',
      ['函数 ', Raw(r('f') + paren(r('x')) + r('=') + frac(r('x+1'), r('x−1'), linear=True),
                   'f(x)=(x+1)/(x-1)'), ' 在 ', Raw(r('x=1'), 'x=1'), ' 处没有定义。'],
      answer='对',
      analysis=['分母 ', Raw(r('x') + ins(r('−1'), 11) + dele(r('+2'), 12) + r('=0'), 'x-1=0'), ' 时分式无意义。']),
    q('s7-08', 'SINGLE',
      ['极限 ', LIM_SIN, ' 的值为（　　）。'],
      opts('0', '1', '3', '∞'), 'C',
      [Raw(frac(func(r('sin', upright=True), r('3x')), r('x')) + r('=3·')
           + frac(func(r('sin', upright=True), r('3x')), r('3x'))
           + group_chr(r('x') + box(r('→')) + r('0'), chr_='→', pos='bot', vert='top') + r('3'),
           r'\frac{\sin 3x}{x}=3\cdot\frac{\sin 3x}{3x}\xrightarrow{x\to 0}3'), '。']),
    q('s7-09', 'SHORT_ANSWER',
      ['计算 ', Raw(ins(nary_int('0', '1', paren(r('2x+1')) + r('dx')), 21), r'\int_{0}^{1}(2x+1)dx'), '。'],
      answer=['原函数为 ', Raw(ssup(r('x'), '2') + r('+x'), 'x^{2}+x'), '，代入上下限得 2。'],
      points=['求出原函数', '代入上下限得 2']),
]

FOOTER_FORMULA = Raw(r('P=') + ssub('n', '1'), 'P=n_{1}')
