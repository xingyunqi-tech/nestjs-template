const THRESHOLDS = {
  docx: { split: 0.98, options: 0.98, answers: 0.98 },
  pdf: { split: 0.95, options: 0.95, answers: 0.95 },
  formula: 0.95,
};

function pct(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function metric(m, threshold) {
  if (!m || m.rate === null) return '—';
  const flag = threshold === undefined ? '' : m.rate >= threshold ? ' ✅' : ' ❌';
  return `${pct(m.rate)} (${m.ok}/${m.total})${flag}`;
}

function cell(text) {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function table(head, rows) {
  return [
    `| ${head.join(' | ')} |`,
    `|${' --- |'.repeat(head.length)}`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function parseSection(rows) {
  const lines = ['## 阶段一：解析', ''];
  lines.push(
    table(
      [
        '样本',
        '格式',
        '耗时',
        '字数',
        '页面',
        '扫描件判定',
        '题号检出',
        '题号顺序',
        '题干缺失',
        '图片',
        '公式',
        '未识别公式结构',
      ],
      rows.map(({ parse: p }) => [
        p.id,
        p.kind,
        `${p.durationMs}ms`,
        String(p.chars),
        p.pages
          ? p.pages
              .map((pg) => `p${pg.page}:${pg.chars}字${pg.twoColumn ? '/双栏' : ''}${pg.lowText ? '/低文字' : ''}`)
              .join(' ')
          : '—',
        p.rejected ? '拒绝' : '通过',
        p.check ? `${p.check.detectedNumbers}/${p.check.expectedNumbers}` : '—',
        p.check ? (p.check.inOrder ? '正确' : '错乱') : '—',
        p.check ? (p.check.missingStems.length ? cell(p.check.missingStems.join(',')) : '无') : '—',
        p.images ? String(p.images) : '—',
        p.formulaCount || p.droppedFormulas || p.oleEquations
          ? `${p.formulaCount}${p.droppedFormulas ? `（页眉页脚另有 ${p.droppedFormulas}）` : ''}${p.oleEquations ? `（OLE 公式 ${p.oleEquations}）` : ''}`
          : '—',
        Object.keys(p.unknownMath).length ? cell(JSON.stringify(p.unknownMath)) : '—',
      ]),
    ),
  );
  lines.push('');

  const scanned = rows.filter((r) => r.parse.expect === 'reject');
  for (const { parse: p } of scanned) {
    lines.push(
      `- 扫描件 ${p.id}：${p.rejected ? '已拒绝 ✅' : '未拒绝 ❌'}（低文字页：${p.lowTextPages?.join(',') || '无'}）`,
    );
  }
  for (const { parse: p } of rows.filter((r) => r.parse.expect !== 'reject' && r.parse.lowTextPages?.length)) {
    lines.push(`- ${p.id} 低文字页（仅标记，不拒绝）：${p.lowTextPages.join(',')}`);
  }
  const wrongReject = rows.filter((r) => r.parse.expect !== 'reject' && r.parse.rejected);
  if (wrongReject.length) lines.push(`- 误判为扫描件：${wrongReject.map((r) => r.parse.id).join(', ')} ❌`);
  for (const { parse: p } of rows) {
    if (p.removedHeaderFooter?.length)
      lines.push(`- ${p.id} 去除的页眉页脚：${cell(p.removedHeaderFooter.join('；'))}`);
    if (p.warnings?.length) lines.push(`- ${p.id} mammoth 提示：${cell(p.warnings.join('；'))}`);
    if (p.droppedFormulas) {
      const where = p.formulaParts
        .filter((x) => !x.inOutput && x.formulas)
        .map((x) => `${x.part}×${x.formulas}`)
        .join('，');
      lines.push(`- ${p.id} 页眉页脚中的公式不进入 mammoth 输出：${where} ⚠️`);
    }
    if (p.oleEquations) {
      lines.push(
        `- ${p.id} 检测到 ${p.oleEquations} 个 OLE 公式对象（MathType / 公式 3.0），当前无法转换，内容会丢失 ⚠️`,
      );
    }
  }
  lines.push('');

  for (const { parse: p } of rows) {
    const f = p.formulaEval;
    if (!f) continue;
    const flag = f.rate >= THRESHOLDS.formula ? '✅' : '❌';
    lines.push(`### 公式还原正确率（${p.id}，构造样本上的结果，仅依赖解析）`, '');
    lines.push(
      `**${pct(f.rate)}**（${f.matched}/${f.expected}，文档中提取 ${f.actual} 个，多余 ${f.extra} 个）${flag}`,
      '',
    );
    if (f.missing.length || f.unexpected.length) {
      lines.push(
        table(
          ['类型', '序号', 'LaTeX'],
          [
            ...f.missing.map((x) => ['期望但未匹配', String(x.index + 1), `\`${cell(x.latex)}\``]),
            ...f.unexpected.map((x) => ['提取但未匹配', String(x.index + 1), `\`${cell(x.latex)}\``]),
          ],
        ),
        '',
      );
    }
  }
  return lines;
}

function extractSection(summary) {
  const lines = ['## 阶段二：提取', ''];
  if (summary.skipReason) {
    lines.push(`已跳过：${summary.skipReason}。`, '');
    return lines;
  }
  lines.push(`模型 \`${summary.model}\`，每块 ${summary.chunkSize} 题。`, '');
  const rows = summary.rows.filter((r) => r.extract);
  lines.push(
    table(
      [
        '样本',
        '题目切分',
        '题干完全一致',
        '选项',
        '答案',
        '答案冲突',
        '公式（多余）',
        '图片数量',
        '题型',
        '材料正文',
        '材料表格',
        '题目归属',
        '题数(期望/提取/多余)',
        '材料(期望/提取)',
      ],
      rows.map(({ parse: p, extract: e }) => {
        if (e.error) return [p.id, cell(`失败：${e.error}`), ...Array(12).fill('')];
        const t = THRESHOLDS[p.kind];
        const m = e.metrics;
        return [
          p.id,
          metric(m.split, t.split),
          metric(m.stemExact),
          metric(m.options, t.options),
          metric(m.answers, t.answers),
          String(m.answerConflicts),
          `${metric(m.formulas, m.formulas.total ? THRESHOLDS.formula : undefined)}（${m.formulas.extra}）`,
          metric(m.images),
          metric(m.type),
          metric(m.materialBody),
          metric(m.materialTable),
          metric(m.attribution),
          `${m.questions.expected}/${m.questions.extracted}/${m.questions.extra}`,
          `${m.materials.expected}/${m.materials.extracted}`,
        ];
      }),
    ),
    '',
  );

  lines.push('### 用量与耗时', '');
  lines.push(
    table(
      [
        '样本',
        '分块',
        '调用次数',
        '截断',
        'JSON 解析失败',
        '调用失败',
        '输入 token',
        '缓存命中',
        '输出 token',
        '耗时',
        '费用',
      ],
      rows
        .filter((r) => r.extract.usage)
        .map(({ parse: p, extract: e }) => [
          p.id,
          e.chunks ? `${e.chunks.length} 题块 + ${e.answerChunks} 答案块` : '—',
          String(e.usage.calls),
          String(e.usage.lengthRetries),
          String(e.usage.parseErrors),
          String(e.usage.errors),
          String(e.usage.inputTokens),
          String(e.usage.cachedInputTokens),
          String(e.usage.outputTokens),
          `${(e.usage.durationMs / 1000).toFixed(1)}s`,
          e.usage.cost === null ? '未配置单价' : e.usage.cost.toFixed(4),
        ]),
    ),
    '',
  );

  const callRows = rows.flatMap(({ parse: p, extract: e }) =>
    (e.calls ?? []).map((c) => [
      p.id,
      c.label,
      String(c.items ?? ''),
      c.finishReason,
      String(c.inputTokens),
      String(c.outputTokens),
      `${c.durationMs}ms`,
      cell(c.parseError ?? '—'),
      cell(c.error ?? '—'),
    ]),
  );
  if (callRows.length) {
    lines.push(
      '### 调用明细',
      '',
      table(['样本', '调用', '单元数', 'finish', '输入', '输出', '耗时', 'parseError', '错误'], callRows),
      '',
    );
  }

  const conflictRows = rows.flatMap(({ parse: p, extract: e }) =>
    (e.conflicts ?? []).map((c) => [p.id, String(c.number), cell(c.inline), cell(c.answerArea)]),
  );
  if (conflictRows.length) {
    lines.push(
      '### 答案冲突（以答案区为准）',
      '',
      table(['样本', '题号', '题目块中的答案', '答案区的答案'], conflictRows),
      '',
    );
  }

  const failures = rows.flatMap(({ parse: p, extract: e }) =>
    (e.metrics?.failures ?? []).map((f) => [p.id, String(f.number), f.field, `\`${cell(f.detail).slice(0, 160)}\``]),
  );
  if (failures.length) {
    lines.push('### 失败明细', '', table(['样本', '题号', '项', '说明'], failures), '');
  }
  return lines;
}

export function renderReport(summary) {
  const lines = ['# M0 技术验证报告', '', `生成时间：${summary.generatedAt}`, ''];
  lines.push(...parseSection(summary.rows), ...extractSection(summary));
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
