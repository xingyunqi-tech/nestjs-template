import ExcelJS from 'exceljs';
import { ImportPackageError } from './import-package-error';
import { IMPORT_SHEETS, ImportSheetName, ImportSheets, emptySheets, normalizeCellText } from './sheet-row';

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if ('richText' in value) {
    return value.richText.map((run) => run.text).join('');
  }
  if ('result' in value) {
    return cellText(value.result ?? null);
  }
  if ('hyperlink' in value) {
    return cellText(value.text);
  }
  return '';
}

const FIXED_DECIMALS_FORMAT = /^0(?:\.(0+))?$/;

function numberText(cell: ExcelJS.Cell, value: number): string {
  const match = FIXED_DECIMALS_FORMAT.exec(cell.numFmt ?? '');
  return match ? value.toFixed(match[1]?.length ?? 0) : cell.text;
}

export async function readWorkbookSheets(buffer: Buffer, maxRowsPerSheet: number): Promise<ImportSheets> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportPackageError('importInvalidWorkbook');
  }

  const sheets = emptySheets();
  for (const worksheet of workbook.worksheets) {
    const name = worksheet.name.trim() as ImportSheetName;
    if (!IMPORT_SHEETS.includes(name)) {
      continue;
    }
    if (worksheet.actualRowCount > maxRowsPerSheet + 1) {
      throw new ImportPackageError('importTooManyRows');
    }
    const headers = new Map<number, string>();
    worksheet.getRow(1).eachCell((cell, column) => {
      const header = cellText(cell.value).trim();
      if (header) {
        headers.set(column, header);
      }
    });
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      const values: Record<string, string> = {};
      const dateColumns: string[] = [];
      row.eachCell((cell, column) => {
        const header = headers.get(column);
        if (!header) {
          return;
        }
        if (cell.value instanceof Date) {
          dateColumns.push(header);
        }
        values[header] = normalizeCellText(
          typeof cell.value === 'number' ? numberText(cell, cell.value) : cellText(cell.value),
        );
      });
      if (Object.values(values).some((value) => value.trim() !== '')) {
        sheets[name].push({ sheet: name, row: rowNumber, values, ...(dateColumns.length > 0 && { dateColumns }) });
      }
    });
  }
  return sheets;
}
