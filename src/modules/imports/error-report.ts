import ExcelJS from 'exceljs';
import { ImportRowError } from './domain/import-row-error';

export const ERROR_REPORT_FILE_NAME = 'import-errors.xlsx';

export async function buildErrorReport(
  errors: ImportRowError[],
  describe: (reason: string) => string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('errors');
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
