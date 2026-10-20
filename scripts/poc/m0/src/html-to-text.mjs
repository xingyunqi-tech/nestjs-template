import { NodeType, parse } from 'node-html-parser';

function inlineText(node) {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text;
  if (node.nodeType !== NodeType.ELEMENT_NODE) return '';
  const tag = node.rawTagName?.toLowerCase();
  if (tag === 'br') return '\n';
  if (tag === 'img') return `![](${node.getAttribute('src') ?? ''})`;
  if (tag === 'a' && node.getAttribute('id') && !node.childNodes.length) return '';
  return node.childNodes.map(inlineText).join('');
}

function cellText(cell) {
  return cell.childNodes.map(inlineText).join(' ').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function tableToMarkdown(table) {
  const rows = table
    .querySelectorAll('tr')
    .map((tr) => tr.childNodes.filter((c) => ['td', 'th'].includes(c.rawTagName?.toLowerCase())).map(cellText));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = rows.map(pad);
  return [`| ${head.join(' | ')} |`, `|${' --- |'.repeat(width)}`, ...body.map((r) => `| ${r.join(' | ')} |`)].join(
    '\n',
  );
}

function blocks(node, out) {
  for (const c of node.childNodes) {
    if (c.nodeType === NodeType.TEXT_NODE) {
      if (c.text.trim()) out.push(c.text.trim());
      continue;
    }
    if (c.nodeType !== NodeType.ELEMENT_NODE) continue;
    const tag = c.rawTagName?.toLowerCase();
    if (tag === 'table') {
      out.push('', tableToMarkdown(c), '');
    } else if (tag === 'ul' || tag === 'ol') {
      blocks(c, out);
    } else {
      const text = inlineText(c).trim();
      if (text) out.push(text);
    }
  }
}

export function htmlToText(html) {
  const out = [];
  blocks(parse(html), out);
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
