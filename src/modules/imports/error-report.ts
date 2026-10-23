import ExcelJS from 'exceljs';
import { ImportRowError } from './domain/import-row-error';

export const ERROR_REPORT_FILE_NAME = 'import-errors.xlsx';

const ERROR_REPORT_SHEET = 'errors';

export interface DescribedImportRowError extends ImportRowError {
  message: string;
}

export async function buildErrorReport(
  errors: ImportRowError[],
  describe: (reason: string) => string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(ERROR_REPORT_SHEET);
  worksheet.columns = [
    { header: 'sheet', key: 'sheet', width: 18 },
    { header: 'row', key: 'row', width: 8 },
    { header: 'field', key: 'field', width: 16 },
    { header: 'reason', key: 'reason', width: 28 },
    { header: 'message', key: 'message', width: 40 },
    { header: 'detail', key: 'detail', width: 40 },
  ];
  worksheet.addRows(errors.map((error) => ({ ...error, detail: error.detail ?? '', message: describe(error.reason) })));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseErrorReport(content: Buffer): Promise<DescribedImportRowError[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ExcelJS.Buffer);
  const errors: DescribedImportRowError[] = [];
  workbook.getWorksheet(ERROR_REPORT_SHEET)?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const text = (column: number): string => row.getCell(column).text;
    errors.push({
      sheet: text(1),
      row: Number(text(2)),
      field: text(3),
      reason: text(4),
      message: text(5),
      ...(text(6) && { detail: text(6) }),
    });
  });
  return errors;
}
