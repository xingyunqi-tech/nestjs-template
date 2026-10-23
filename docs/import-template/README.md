# 题目导入模板

---

## Table of Contents <!-- omit in toc -->

- [目录内容](#目录内容)
- [打包](#打包)
- [导入](#导入)
  - [命令行](#命令行)
  - [管理端接口](#管理端接口)
- [工作表与列](#工作表与列)
- [答案写法](#答案写法)
- [图片与音频](#图片与音频)
- [导入规则](#导入规则)

---

## 目录内容

行测样例，包含知识点、单选、多选、判断、填空、材料题（两道小题，材料含图片）与一份模拟卷：

| 文件                | 说明                                     |
| ------------------- | ---------------------------------------- |
| `content.xlsx`      | 导入内容，每个工作表对应一类数据         |
| `content.json`      | 与 `content.xlsx` 字段一一对应的 JSON 版 |
| `assets/chart1.png` | 材料中引用的图片                         |

样例中的考试与科目为「国考 / 行测」，导入前需在管理端建好同名考试与科目。

## 打包

导入包为 zip，根目录放 `content.xlsx`（或 `content.json`，二选一）与 `assets/` 目录：

```bash
cd docs/import-template
zip -r ../../xingce-sample.zip content.xlsx assets
```

不含图片音频时，也可以直接导入单独的 `.xlsx` 或 `.json` 文件。

## 导入

### 命令行

```bash
pnpm import:content ./xingce-sample.zip            # 导入为草稿
pnpm import:content ./xingce-sample.zip --publish  # 导入成功的题目与试卷直接发布
```

终端逐行输出错误（工作表:行号 [字段] 错误键 说明），最后输出任务统计；全部成功时退出码为 0。生产环境构建后使用 `pnpm import:content:prod`。

### 管理端接口

权限 `content:manage`，`publishOnImport=true` 仅管理员可用。

| 方法 | 路径                             | 说明                                                                                                          |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST | `/admin/imports/precheck`        | 预检，请求体与创建任务相同；同步返回将新建 / 更新 / 跳过的数量与错误行，不写入任何数据                        |
| POST | `/admin/imports`                 | multipart 上传 `file`，或 JSON 传已上传（`purpose=import`）的 `fileId`；返回任务                              |
| GET  | `/admin/imports`                 | 任务列表，可按 `status` 筛选                                                                                  |
| GET  | `/admin/imports/:id`             | 状态（`PENDING` / `RUNNING` / `DONE` / `FAILED`）、`total`、`succeeded`、`skipped`、`failed`、`failureReason` |
| GET  | `/admin/imports/:id/errors`      | 下载错误行报告 xlsx（工作表、行号、字段、错误键、说明、详情）                                                 |
| GET  | `/admin/imports/:id/errors.json` | 错误行明细 JSON，字段与 xlsx 报告相同；`page`、`limit`（≤ 200）分页，`sheet` 按工作表筛选                     |

预检按真实导入的顺序完整解析与校验：不保存导入包、不上传素材（仍检查素材是否存在、类型与大小）、不写入题库、不建任务；包内新建的知识点、本包新题被试卷引用、内容重复等跨单元情况在内存中模拟。返回 `wouldCreate`、`wouldUpdate`、`wouldSkip`（按知识点行、材料、独立题、试卷分别计数）、`errors`（最多 500 条，含与 xlsx 报告相同的 `message`）与 `truncated`。`publishOnImport` 影响试卷能否引用本包新题，同样仅管理员可用。导入单元超过 2000 个时返回 413（`importPrecheckTooLarge`），请直接导入后查看错误报告。预检与随后的真实导入之间若有其他人修改题库（如新建同名试卷、发布或修改被引用的题目），结果可能不同。

任务在队列中异步执行，整体失败（导入包无法解析等）时写入管理员告警。执行超过 30 分钟或排队超过 10 分钟仍未结束的任务由定时任务置为失败（`importInterrupted`）并告警，不会自动重跑，需重新提交。

## 工作表与列

科目一律以 `exam` + `subject`（考试名称 + 科目名称）定位；`id` 填写已有记录的 ID 时更新该记录，更新行中留空的单元格表示保持原值（含 `stem`、选项、`answer`、`audio`、`knowledgePath`、`isFree`；选项列要么全部留空，要么完整填写），新建行留空时使用默认值。

- `knowledge_points`：`exam`、`subject`、`path`（`/` 分隔的层级，缺少的层级自动创建）
- `materials`：`materialKey`（包内唯一）、`id`、`exam`、`subject`、`stem`（材料题干，默认「根据以下材料回答问题。」）、`material`、`audio`、`analysis`、`source`、`sourceNote`、`isFree`
- `questions`：`questionKey`、`id`、`exam`、`subject`、`materialKey`、`order`（材料小题必填）、`type`、`stem`、`optionA` … `optionZ` 或 `options`（见下文）、`answer`、`points`、`analysis`、`difficulty`（1-5）、`knowledgePath`（叶子知识点路径，多个时每行一个）、`source`、`sourceNote`、`isFree`；材料小题的 `source`、`sourceNote`、`isFree` 跟随材料
- `papers`：`paperKey`、`id`（仅草稿试卷）、`exam`、`subject`、`title`、`type`（`REAL` / `MOCK` / `SPECIAL`）、`year`、`durationMin`、`multiScoringRule`（`ALL_OR_NOTHING` / `PARTIAL`）、`isFree`
- `paper_questions`：`paperKey`、`sectionTitle`、`sectionType`、`sort`、`questionKey` / `questionId` / `materialKey`（三选一）、`score`（材料为每道小题的分值）

选项有两种写法，同一行只能用其中一种（同时填写报 `importOptionColumnsConflict`）：

- `optionA` … `optionZ`：每个选项一列，最多 26 个；
- `options`：单列，每行一个选项。每行都以字母加「`.`」「`．`」「`、`」「`:`」「`：`」或「`(A)`」「`（A）`」「`A)`」「`A）`」开头时按前缀取选项字母（全角与小写字母按大写处理）；每行都不带前缀时按顺序编号为 A、B、C…（最多 26 行）；两种行混用报 `invalidImportValue`。单列写法中每个选项只能占一行，选项内容需要换行时用 `optionX` 列。

`type` 取 `SINGLE` / `MULTIPLE` / `JUDGE` / `FILL` / `SHORT_ANSWER` / `ESSAY`；`source` 取 `ORIGINAL` / `PUBLIC` / `AI_GENERATED`；`isFree` 填「是 / 否」，默认是。

JSON 版顶层键为工作表名，值为行对象数组，字段名与列名相同；`points`、`knowledgePath`、`options` 也可写成字符串数组（每个元素一行）。

模板中的文本列已设为文本格式；自行制作 xlsx 时请同样把答案、选项、题干等列设为文本，避免 Excel 把 `0.50` 存成数字或把内容识别为日期（日期单元格会报 `invalidImportValue`）。

## 答案写法

```text
单选    B
多选    ACD
判断    对 / 错
填空    空与空之间用 || 分隔，同一空的候选答案用 | 分隔，如：北京|北京市||1949
        答案本身含 | 或 \ 时以 \ 转义，如：a\|b
主观题  参考答案文本，要点写在 points 列，每行一个
```

## 图片与音频

题干、选项、解析、材料与材料题干中写 `![](assets/文件名)`，`audio` 列写 `assets/` 下的音频文件名。导入时上传为公共文件，内容中保存为 `file:{fileId}`；已有内容完全相同的公共文件时直接复用，因此重复导入同一个包不会产生新文件。单元写入失败时，本单元新上传且未被复用的文件会被删除。

只接受 jpg、png、gif、webp 图片与 mp3、m4a 音频，扩展名与文件头须一致；单个文件大小沿用上传接口的限制。导入包（包括其中的 `content.xlsx`）的文件数与解压总大小有上限。zip 内文件名支持 UTF-8 与 GBK 编码。

## 导入规则

- 材料与其全部小题、每道独立题、每份试卷、每行知识点各为一个导入单元，单元内任一行出错则整个单元不写入。
- 试卷引用的题目导入失败时该试卷失败。试卷只能引用已发布的题目，因此含新题的包按两步导入：
  1. 先导入题目，审核发布后再导入试卷（试卷行用 `questionId` 或同一批 `questionKey` 引用）；
  2. 或导入时直接发布（`--publish` / `publishOnImport`），题目与试卷在同一个包内完成。
     不发布时引用新题的试卷会报 `paperQuestionNotPublished`。
- 已发布题目更新时生成 `EDIT` 新版本，内容未变化时不产生新版本；修改答案、题型、选项 key 或填空空数的行报 `answerChangeNotAllowed`，答案修改须走勘误。
- 新建行的内容与已有题目重复（`contentHash` 相同）时视为已存在：`questionKey` / `materialKey` 绑定到已有题目供试卷引用，计入 `skipped`，不记错误行（材料的小题数与已有材料不一致时仍报 `duplicateQuestion`）。
- 已存在的知识点路径、不带 `id` 且同科目已有同名试卷的试卷行同样计入 `skipped`；需要更新试卷时填写 `id`。
