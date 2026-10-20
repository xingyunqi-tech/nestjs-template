import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { htmlToText } from './html-to-text.mjs';
import { OmmlConverter } from './omml.mjs';

const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const O_NS = 'urn:schemas-microsoft-com:office:office';
const MATH_PROG_ID = /Equation|MathType/i;

const PARTS = [
  { pattern: /^word\/document\.xml$/, output: true },
  { pattern: /^word\/footnotes\.xml$/, output: true },
  { pattern: /^word\/endnotes\.xml$/, output: true },
  { pattern: /^word\/header\d*\.xml$/, output: false },
  { pattern: /^word\/footer\d*\.xml$/, output: false },
];

function textRun(doc, text) {
  const run = doc.createElementNS(W_NS, 'w:r');
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
  return run;
}

function insideDeletion(node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p.namespaceURI === W_NS && (p.localName === 'del' || p.localName === 'moveFrom')) return true;
  }
  return false;
}

function oleEquations(doc) {
  return Array.from(doc.getElementsByTagNameNS(O_NS, 'OLEObject')).filter((ole) =>
    MATH_PROG_ID.test(ole.getAttribute('ProgID') ?? ''),
  ).length;
}

function replacePartMath(doc, converter) {
  for (const para of Array.from(doc.getElementsByTagNameNS(M_NS, 'oMathPara'))) {
    for (const math of Array.from(para.getElementsByTagNameNS(M_NS, 'oMath'))) {
      para.parentNode.insertBefore(math, para);
    }
    para.parentNode.removeChild(para);
  }
  const formulas = [];
  let deleted = 0;
  for (const math of Array.from(doc.getElementsByTagNameNS(M_NS, 'oMath'))) {
    if (insideDeletion(math)) {
      deleted += 1;
      math.parentNode.removeChild(math);
      continue;
    }
    const latex = converter.convert(math);
    formulas.push(latex);
    math.parentNode.replaceChild(textRun(doc, `$${latex}$`), math);
  }
  return { formulas, deleted };
}

export async function replaceMath(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const converter = new OmmlConverter();
  const names = Object.keys(zip.files).sort();
  const formulas = [];
  const parts = [];
  for (const { pattern, output } of PARTS) {
    for (const name of names.filter((n) => pattern.test(n))) {
      const doc = new DOMParser().parseFromString(await zip.file(name).async('string'), 'text/xml');
      const ole = oleEquations(doc);
      const { formulas: found, deleted } = replacePartMath(doc, converter);
      if (found.length || ole || deleted) {
        parts.push({ part: name, formulas: found.length, deleted, oleEquations: ole, inOutput: output });
      }
      if (output) formulas.push(...found);
      zip.file(name, new XMLSerializer().serializeToString(doc));
    }
  }
  const output = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer: output, formulas, parts, unknown: Object.fromEntries(converter.unknown) };
}

export async function parseDocx(file, outDir) {
  const { buffer, formulas, parts, unknown } = await replaceMath(await readFile(file));
  const assetsDir = path.join(outDir, 'assets');
  const prefix = path.basename(file, '.docx');
  let imageCount = 0;

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        imageCount += 1;
        const ext = (image.contentType.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace(/\+.*/, '');
        const name = `${prefix}-img${imageCount}.${ext}`;
        await mkdir(assetsDir, { recursive: true });
        await writeFile(path.join(assetsDir, name), await image.readAsBuffer());
        return { src: `assets/${name}` };
      }),
    },
  );

  return {
    text: htmlToText(result.value),
    formulas,
    formulaParts: parts,
    droppedFormulas: parts.filter((p) => !p.inOutput).reduce((n, p) => n + p.formulas, 0),
    oleEquations: parts.reduce((n, p) => n + p.oleEquations, 0),
    unknownMath: unknown,
    images: imageCount,
    warnings: result.messages.map((m) => `${m.type}: ${m.message}`),
  };
}
