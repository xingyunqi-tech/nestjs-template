import { ImportPackageError } from './import-package-error';
import { IMPORT_SHEETS, ImportSheets, emptySheets, normalizeCellText } from './sheet-row';

function fieldText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalizeCellText(String(value));
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
    return value.map((item) => normalizeCellText(String(item))).join('\n');
  }
  return null;
}

/** 与 xlsx 工作表一一对应的 JSON：顶层键为工作表名，值为对象数组 */
export function readJsonSheets(buffer: Buffer, maxRowsPerSheet: number): ImportSheets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''));
  } catch {
    throw new ImportPackageError('importInvalidJson');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ImportPackageError('importInvalidJson');
  }

  const sheets = emptySheets();
  for (const name of IMPORT_SHEETS) {
    const rows = (parsed as Record<string, unknown>)[name];
    if (rows === undefined) {
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new ImportPackageError('importInvalidJson');
    }
    if (rows.length > maxRowsPerSheet) {
      throw new ImportPackageError('importTooManyRows');
    }
    rows.forEach((item: unknown, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new ImportPackageError('importInvalidJson');
      }
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(item)) {
        const text = fieldText(value);
        if (text === null) {
          throw new ImportPackageError('importInvalidJson');
        }
        values[key] = text;
      }
      sheets[name].push({ sheet: name, row: index + 1, values });
    });
  }
  return sheets;
}
