import { readZipEntries, ZipLimits } from './zip-archive';
import { readWorkbookSheets } from './workbook-content';
import { readJsonSheets } from './json-content';
import { ImportPackageError } from './import-package-error';
import { ImportSheets } from './sheet-row';

export interface ImportPackage {
  sheets: ImportSheets;
  /** 键为相对 assets/ 的路径 */
  assets: Map<string, Buffer>;
}

export interface ImportPackageLimits extends ZipLimits {
  maxRowsPerSheet: number;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const ASSETS_DIR = 'assets/';

function isZip(buffer: Buffer): boolean {
  return ZIP_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

function isJson(buffer: Buffer): boolean {
  return /^﻿?\s*\{/.test(buffer.subarray(0, 64).toString('utf8'));
}

/** 所有条目位于同一顶层目录时去掉该目录 */
function stripCommonRoot(entries: Map<string, Buffer>): Map<string, Buffer> {
  const names = [...entries.keys()];
  const root = names[0]?.split('/')[0];
  if (!root || names.some((name) => !name.startsWith(`${root}/`))) {
    return entries;
  }
  return new Map(names.map((name) => [name.slice(root.length + 1), entries.get(name)!]));
}

/** 支持 zip（content.xlsx 或 content.json + assets/）、单独的 xlsx 或 JSON */
export async function readImportPackage(buffer: Buffer, limits: ImportPackageLimits): Promise<ImportPackage> {
  if (isJson(buffer)) {
    return { sheets: readJsonSheets(buffer, limits.maxRowsPerSheet), assets: new Map() };
  }
  if (!isZip(buffer)) {
    throw new ImportPackageError('importInvalidPackage');
  }

  const raw = await readZipEntries(buffer, limits);
  if (raw.has('[Content_Types].xml') && raw.has('xl/workbook.xml')) {
    return { sheets: await readWorkbookSheets(buffer, limits.maxRowsPerSheet), assets: new Map() };
  }

  const entries = stripCommonRoot(raw);
  const assets = new Map(
    [...entries]
      .filter(([name]) => name.startsWith(ASSETS_DIR) && name.length > ASSETS_DIR.length)
      .map(([name, content]) => [name.slice(ASSETS_DIR.length), content]),
  );
  const workbook = entries.get('content.xlsx');
  if (workbook) {
    await readZipEntries(workbook, limits);
    return { sheets: await readWorkbookSheets(workbook, limits.maxRowsPerSheet), assets };
  }
  const json = entries.get('content.json');
  if (json) {
    return { sheets: readJsonSheets(json, limits.maxRowsPerSheet), assets };
  }
  throw new ImportPackageError('importContentMissing');
}
