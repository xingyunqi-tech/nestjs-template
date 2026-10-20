"""生成 M0 技术验证样本：docx / pdf 文档与 expected/*.json"""

import json
import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph, Spacer

from data import S1_QUESTIONS, S2_QUESTIONS, S3_QUESTIONS, S4_MATERIALS, S4_SUBJECTIVE, S5_QUESTIONS
from formula import plain
from handmade import FOOTER_FORMULA, S7_QUESTIONS

OUT = Path(__file__).resolve().parent / 'output'
EXPECTED = Path(__file__).resolve().parent / 'expected'
CJK_FONT_FILE = '/System/Library/Fonts/STHeiti Light.ttc'
PDF_FONT_FILE = '/System/Library/Fonts/Supplemental/Songti.ttc'
CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'


# ---------- expected ----------

def expected_question(item, number, material_key=None, order=None):
    row = {'questionKey': item['key'], 'number': number, 'type': item['type']}
    if material_key:
        row['materialKey'] = material_key
        row['order'] = order
    stem = plain(item['stem'])
    if item.get('image'):
        stem += f'\n\n![](assets/{item["image"]})'
    row['stem'] = stem
    for letter, content in item['options']:
        row[f'option{letter}'] = plain(content)
    row['answer'] = plain(item['answer'])
    if item['points']:
        row['points'] = '\n'.join(item['points'])
    if item['analysis']:
        row['analysis'] = plain(item['analysis'])
    return row


def markdown_table(rows):
    head, *body = rows
    lines = ['| ' + ' | '.join(head) + ' |', '|' + ' --- |' * len(head)]
    lines += ['| ' + ' | '.join(r) + ' |' for r in body]
    return '\n'.join(lines)


def write_expected(name, sources, questions, materials=(), expect='extract', notes=''):
    EXPECTED.mkdir(parents=True, exist_ok=True)
    payload = {'sources': sources, 'expect': expect, 'notes': notes, 'materials': list(materials), 'questions': questions}
    (EXPECTED / f'{name}.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


# ---------- docx ----------

def new_document(header, footer_prefix='第 '):
    doc = Document()
    style = doc.styles['Normal']
    style.font.name = 'Times New Roman'
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    section = doc.sections[0]
    section.left_margin = section.right_margin = Cm(2.2)
    section.header.paragraphs[0].text = header
    footer = section.footer.paragraphs[0]
    footer.add_run(footer_prefix)
    field = OxmlElement('w:fldSimple')
    field.set(qn('w:instr'), 'PAGE')
    run = OxmlElement('w:r')
    text = OxmlElement('w:t')
    text.text = '1'
    run.append(text)
    field.append(run)
    footer._p.append(field)
    footer.add_run(' 页')
    return doc


def display_answer(answer):
    if not isinstance(answer, str):
        return answer
    return '；'.join('/'.join(blank.split('|')) for blank in answer.split('||'))


def add_rich(paragraph, segments):
    if isinstance(segments, str):
        paragraph.add_run(segments)
        return
    for seg in segments:
        if hasattr(seg, 'omml'):
            paragraph._p.append(parse_xml(seg.omml()))
        else:
            paragraph.add_run(seg)


def add_question(doc, number, item, inline_answer):
    p = doc.add_paragraph()
    p.add_run(f'{number}．')
    add_rich(p, item['stem'])
    if item.get('image'):
        doc.add_picture(str(OUT / item['image']), width=Cm(11))
    if item.get('inline_options'):
        p = doc.add_paragraph()
        for i, (letter, content) in enumerate(item['options']):
            if i:
                p.add_run('\t')
            p.add_run(f'{letter}．')
            add_rich(p, content)
    else:
        for letter, content in item['options']:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.7)
            p.add_run(f'{letter}．')
            add_rich(p, content)
    if inline_answer:
        add_answer(doc, item, '【答案】', '【解析】')


def add_answer(doc, item, answer_label, analysis_label, prefix=''):
    p = doc.add_paragraph()
    p.add_run(prefix + answer_label)
    add_rich(p, display_answer(item['answer']))
    if item['points']:
        p = doc.add_paragraph('评分要点：' + ''.join(f'{CIRCLED[i]}{pt}；' for i, pt in enumerate(item['points'])))
    if item['analysis']:
        p = doc.add_paragraph()
        p.add_run(analysis_label)
        add_rich(p, item['analysis'])


def heading(doc, text, size=12):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size)


def build_chart():
    img = Image.new('RGB', (640, 360), 'white')
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(CJK_FONT_FILE, 18)
    draw.text((180, 12), '某企业 2023 年各季度销售额（万元）', fill='black', font=font)
    draw.line((60, 310, 610, 310), fill='black', width=2)
    for i, (label, value) in enumerate([('一季度', 120), ('二季度', 150), ('三季度', 180), ('四季度', 140)]):
        x = 100 + i * 130
        draw.rectangle((x, 310 - value, x + 60, 310), fill=(70, 110, 180))
        draw.text((x + 12, 310 - value - 24), str(value), fill='black', font=font)
        draw.text((x + 2, 318), label, fill='black', font=font)
    img.save(OUT / 's1-chart.png')


def build_s1():
    doc = new_document('2026 年公务员录用考试《行政职业能力测验》模拟卷（一）')
    heading(doc, '行政职业能力测验模拟卷（一）', 14)
    doc.add_paragraph('说明：本卷共 20 题，每题后附答案与解析。')
    for i, item in enumerate(S1_QUESTIONS, 1):
        add_question(doc, i, item, inline_answer=True)
    doc.save(OUT / 's1-xingce.docx')
    write_expected('s1-xingce', ['s1-xingce.docx'],
                   [expected_question(it, i) for i, it in enumerate(S1_QUESTIONS, 1)],
                   notes='每题后紧跟【答案】【解析】；第 11 题含插图；部分题目选项在同一行用制表符分隔')


def build_s2():
    doc = new_document('2026 年全国硕士研究生招生考试 数学（模拟）')
    heading(doc, '数学模拟试题', 14)
    heading(doc, '一、选择题、填空题与判断题')
    for i, item in enumerate(S2_QUESTIONS[:8], 1):
        add_question(doc, i, item, inline_answer=False)
    heading(doc, '二、解答题')
    for i, item in enumerate(S2_QUESTIONS[8:], 9):
        add_question(doc, i, item, inline_answer=False)
    doc.add_page_break()
    heading(doc, '参考答案与解析', 14)
    for i, item in enumerate(S2_QUESTIONS, 1):
        add_answer(doc, item, '', '解析：', prefix=f'{i}．')
    doc.save(OUT / 's2-math.docx')
    write_expected('s2-math', ['s2-math.docx'],
                   [expected_question(it, i) for i, it in enumerate(S2_QUESTIONS, 1)],
                   notes='公式为 Word 原生公式（OMML），期望文本中以 $LaTeX$ 表示；答案集中在文末另起一页')


def build_s4():
    doc = new_document('2026 年事业单位招聘考试 综合能力测试（模拟）')
    number = 0
    materials, questions = [], []
    for m in S4_MATERIALS:
        heading(doc, m['stem'])
        doc.add_paragraph(m['material'])
        material_text = m['material']
        if m['table']:
            table = doc.add_table(rows=len(m['table']), cols=len(m['table'][0]))
            table.style = 'Table Grid'
            for r, row in enumerate(m['table']):
                for c, cell in enumerate(row):
                    table.cell(r, c).text = cell
            material_text += '\n\n' + markdown_table(m['table'])
        materials.append({'materialKey': m['key'], 'stem': m['stem'], 'material': material_text})
        for order, item in enumerate(m['questions'], 1):
            number += 1
            add_question(doc, number, item, inline_answer=True)
            questions.append(expected_question(item, number, m['key'], order))
    heading(doc, '主观题')
    for item in S4_SUBJECTIVE:
        number += 1
        add_question(doc, number, item, inline_answer=False)
        add_answer(doc, item, '【参考答案】', '【解析】')
        questions.append(expected_question(item, number))
    doc.save(OUT / 's4-material.docx')
    write_expected('s4-material', ['s4-material.docx'], questions, materials,
                   notes='两组材料题（含表格）+ 简答、申论；表格在期望中转为 Markdown 表格')


def build_s5():
    doc = new_document('公共基础知识专项练习（题目卷）')
    heading(doc, '公共基础知识专项练习', 14)
    doc.add_paragraph('说明：答案与解析见另附的答案卷。')
    for i, item in enumerate(S5_QUESTIONS, 1):
        add_question(doc, i, item, inline_answer=False)
    doc.save(OUT / 's5-questions.docx')

    doc = new_document('公共基础知识专项练习（答案卷）')
    heading(doc, '参考答案及解析', 14)
    table = doc.add_table(rows=len(S5_QUESTIONS) + 1, cols=3)
    table.style = 'Table Grid'
    for c, text in enumerate(['题号', '答案', '解析']):
        table.cell(0, c).text = text
    for i, item in enumerate(S5_QUESTIONS, 1):
        table.cell(i, 0).text = str(i)
        table.cell(i, 1).text = display_answer(item['answer'])
        table.cell(i, 2).text = item['analysis']
    doc.save(OUT / 's5-answers.docx')
    write_expected('s5-split', ['s5-questions.docx', 's5-answers.docx'],
                   [expected_question(it, i) for i, it in enumerate(S5_QUESTIONS, 1)],
                   notes='题目与答案分属两个文件；答案卷为表格，填空题同义答案用“/”分隔')


def build_s7():
    doc = new_document('2026 年数学模拟（Word 手工编辑公式）')
    footer = doc.sections[0].footer.add_paragraph('页脚公式：')
    footer._p.append(parse_xml(FOOTER_FORMULA.omml()))
    heading(doc, '数学模拟试题（公式由 Word 公式编辑器录入）', 14)
    for i, item in enumerate(S7_QUESTIONS, 1):
        add_question(doc, i, item, inline_answer=True)
    doc.save(OUT / 's7-math-handmade.docx')
    write_expected('s7-math-handmade', ['s7-math-handmade.docx'],
                   [expected_question(it, i) for i, it in enumerate(S7_QUESTIONS, 1)],
                   notes='手写的 Word 风格 OMML：m:rPr/w:rPr/m:ctrlPr、sSubSup、acc、bar、矩阵、eqArr、groupChr、'
                         '线性分式、box、修订标记 w:ins/w:del；页脚另有 1 个公式，不进入正文')


# ---------- pdf ----------

def build_s3(file_name='s3-two-column.pdf', closing_page=None):
    pdfmetrics.registerFont(TTFont('Songti', PDF_FONT_FILE, subfontIndex=0))
    body = ParagraphStyle('body', fontName='Songti', fontSize=10, leading=15, wordWrap='CJK')
    option = ParagraphStyle('option', parent=body, leftIndent=8)
    title = ParagraphStyle('title', parent=body, fontSize=12, leading=20, spaceBefore=6)
    width, height = A4
    margin, gap = 18 * mm, 8 * mm
    col = (width - 2 * margin - gap) / 2
    top, bottom = height - 24 * mm, 20 * mm

    def decorate(c, doc_):
        c.saveState()
        c.setFont('Songti', 9)
        c.drawCentredString(width / 2, height - 14 * mm, '2025 年某省公务员录用考试《行政职业能力测验》（模拟）')
        c.line(margin, height - 16 * mm, width - margin, height - 16 * mm)
        c.line(width / 2, bottom, width / 2, top)
        c.drawCentredString(width / 2, 12 * mm, f'— {doc_.page} —')
        c.restoreState()

    frames = [Frame(margin, bottom, col, top - bottom, id='left'),
              Frame(margin + col + gap, bottom, col, top - bottom, id='right')]
    doc = BaseDocTemplate(str(OUT / file_name), pagesize=A4,
                          pageTemplates=[PageTemplate(id='two', frames=frames, onPage=decorate)])
    story = [Paragraph('一、常识判断与言语理解', title)]
    for i, item in enumerate(S3_QUESTIONS, 1):
        if i == 11:
            story.append(Paragraph('二、数量关系', title))
        story.append(Paragraph(f'{i}．{item["stem"]}', body))
        texts = [f'{letter}．{content}' for letter, content in item['options']]
        if max(len(t) for t in texts) <= 6:
            story.append(Paragraph('　　'.join(texts), option))
        else:
            story.extend(Paragraph(t, option) for t in texts)
        story.append(Spacer(1, 4))
    story.append(Paragraph('参考答案', title))
    answers = [item['answer'] for item in S3_QUESTIONS]
    for start in range(0, len(answers), 5):
        group = answers[start:start + 5]
        story.append(Paragraph(f'{start + 1}—{start + len(group)}：' + '、'.join(group), body))
    if closing_page:
        story.extend([PageBreak(), Paragraph(closing_page, body)])
    doc.build(story)
    if closing_page:
        return
    write_expected('s3-two-column', ['s3-two-column.pdf'],
                   [expected_question({**it, 'analysis': ''}, i) for i, it in enumerate(S3_QUESTIONS, 1)],
                   notes='双栏、页眉页脚页码、题目跨栏跨页；短选项两两并排；答案以“1—5：B、C、…”形式集中在文末，无解析')


def build_s6():
    dpi = 150
    w, h = int(210 / 25.4 * dpi), int(297 / 25.4 * dpi)
    img = Image.new('L', (w, h), 255)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(CJK_FONT_FILE, 26)
    y = 120
    for i, item in enumerate(S5_QUESTIONS[:5], 1):
        draw.text((110, y), f'{i}．{item["stem"]}', fill=0, font=font)
        y += 48
        draw.text((150, y), '　'.join(f'{l}．{c}' for l, c in item['options']), fill=0, font=font)
        y += 70
    path = OUT / 's6-scanned.png'
    img.rotate(0.6, fillcolor=255).save(path)
    c = canvas.Canvas(str(OUT / 's6-scanned.pdf'), pagesize=A4)
    c.drawImage(str(path), 0, 0, width=A4[0], height=A4[1])
    c.save()
    path.unlink()
    write_expected('s6-scanned', ['s6-scanned.pdf'], [], expect='reject', notes='整页为图片、无文字层，应判定为扫描件并拒绝')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    build_chart()
    build_s1()
    build_s2()
    build_s3()
    build_s3('s3-short-tail.pdf', closing_page='（全卷完）')
    build_s4()
    build_s5()
    build_s6()
    build_s7()
    print('\n'.join(sorted(p.name for p in OUT.iterdir())), file=sys.stdout)


if __name__ == '__main__':
    main()
