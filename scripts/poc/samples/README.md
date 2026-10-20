# M0 技术验证样本

前端仓库 `docs/ops-import-ai-plan.md` 第 3 节「M0 技术验证」使用的构造样本。题目数据只维护一份，放在 `data.py`；`build_samples.py` 读取它，同时生成 `output/` 下的文档和 `expected/` 下的标准答案。

## 文件

| 样本 | 文档                                    | 标准答案                | 覆盖情况                                                                                                                                                                                                            |
| ---- | --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| s1   | `s1-xingce.docx`                        | `s1-xingce.json`        | 每题后紧跟【答案】【解析】；插图；同一行的选项用制表符分隔；页眉页脚                                                                                                                                                |
| s2   | `s2-math.docx`                          | `s2-math.json`          | Word 原生公式（OMML），出现在题干、选项、答案中；答案集中在文末                                                                                                                                                     |
| s3   | `s3-two-column.pdf`                     | `s3-two-column.json`    | 双栏；页眉页脚页码；题目跨栏；短选项并排；答案以「1—5：B、A、…」集中在文末，没有解析                                                                                                                                |
| s3t  | `s3-short-tail.pdf`                     | `s3-two-column.json`    | s3 末尾追加一页，只有「（全卷完）」，用于确认短尾页不会被判为扫描件                                                                                                                                                 |
| s4   | `s4-material.docx`                      | `s4-material.json`      | 两组材料题（其中一组含表格）、简答题、申论题                                                                                                                                                                        |
| s5   | `s5-questions.docx` + `s5-answers.docx` | `s5-split.json`         | 题目和答案分两个文件，答案卷是表格                                                                                                                                                                                  |
| s6   | `s6-scanned.pdf`                        | `s6-scanned.json`       | 整页图片、没有文字层，应判定为扫描件并拒绝                                                                                                                                                                          |
| s7   | `s7-math-handmade.docx`                 | `s7-math-handmade.json` | 按 Word 实际输出风格手写的 OMML（见 `handmade.py`）：`m:rPr`、`w:rPr`、`m:ctrlPr`、`m:sSubSup`、`m:acc`、`m:bar`、`m:m` 矩阵、`m:eqArr`、`m:groupChr`、线性分式、`m:box`、`w:ins` / `w:del` 修订；页脚另有 1 个公式 |

s2、s7 的公式都是构造出来的，公式还原率只说明脚本在这些构造样本上的表现，不代表真实试卷。MathType（OLE 对象）公式无法离线构造，样本中没有覆盖；m0 脚本只检测并计数 `o:OLEObject`（ProgID 含 `Equation` / `MathType`），不做转换。

## 标准答案格式

`expected/*.json` 的结构为 `{ sources, expect, notes, materials, questions }`。

- `expect` 取值为 `extract`（应提取）或 `reject`（应拒绝）。
- `questions` 的字段沿用导入模板的列名：`questionKey`、`materialKey`、`order`、`type`、`stem`、`optionA`…、`answer`、`points`、`analysis`。另加一个 `number` 字段，表示题目在文档中的题号。
- 答案写法与导入模板一致：
  - 多选写成 `ABD`
  - 判断写 `对` 或 `错`
  - 填空题中，同一空的同义答案用 `|` 分隔，不同空之间用 `||` 分隔
- 文档里的答案用试卷上的自然写法：同义答案用「/」分隔，多空之间用「；」分隔，不出现 `|`、`||`。
- 公式写成 `$LaTeX$`，图片写成 `![](assets/文件名)`，表格写成 Markdown 表格。

## 重新生成

依赖 macOS 自带的中文字体（`STHeiti Light.ttc`、`Songti.ttc`）。

```bash
python3 -m venv /tmp/m0-venv
/tmp/m0-venv/bin/pip install reportlab==4.2.5 python-docx==1.2.0 Pillow==10.4.0
/tmp/m0-venv/bin/python build_samples.py
```

## 已观察到的解析结果

基于 `m0/package.json` 锁定的 `mammoth@1.13.0` 与 `unpdf@1.8.1`：

- `mammoth` 仍会丢掉 OMML 公式，s2 题干和选项中公式的位置为空；m0 在交给 mammoth 之前先把 OMML 转成 `$LaTeX$`。
- `mammoth` 的 Markdown 输出把表格拆成逐个单元格的段落，表格结构丢失；m0 改用它的 HTML 输出再转 Markdown 表格。
- `unpdf` 的 `extractText` 在 s3 上按内容流顺序输出，栏序恰好正确，但页眉、页码混在每页开头，长题干在原换行处断开。m0 不依赖这一顺序，而是用文字坐标自行识别页眉页脚和分栏。
- `unpdf` 提取 s6 得到 0 个字符。
- m0 阶段一（`pnpm parse`）的当前结果：s1–s5、s7 题号全部检出且顺序正确；s6 被拒绝，s3 与 s3t 未被误拒（s3t 第 3 页标记为低文字页）；公式还原率在构造样本 s2 上为 21/21、s7 上为 25/25，均无多余公式，s7 页脚中的 1 个公式单独报告。
