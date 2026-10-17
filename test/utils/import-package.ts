import { crc32 } from 'zlib';
import ExcelJS from 'exceljs';
import { ZipFile } from 'yazl';

export type SheetRows = Record<string, Record<string, string | number | boolean>[]>;

export async function buildWorkbook(sheets: SheetRows): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const worksheet = workbook.addWorksheet(name);
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    worksheet.columns = columns.map((column) => ({ header: column, key: column }));
    worksheet.addRows(rows);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function buildZip(entries: Record<string, Buffer | string>, compress = true): Promise<Buffer> {
  const zipfile = new ZipFile();
  for (const [name, content] of Object.entries(entries)) {
    zipfile.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name, { compress });
  }
  zipfile.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zipfile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on('error', reject);
  });
}

export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface RawZipEntry {
  name: Buffer;
  content: Buffer;
  utf8: boolean;
}

/** 不压缩的最小 zip，文件名按原始字节写入，用于模拟非 UTF-8 编码的文件名 */
export function buildRawZip(entries: RawZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const crc = crc32(entry.content);
    const flag = entry.utf8 ? 0x800 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flag, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(entry.name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flag, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.content.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt32LE(offset, 42);
    const record = Buffer.concat([local, entry.name, entry.content]);
    locals.push(record);
    centrals.push(Buffer.concat([central, entry.name]));
    offset += record.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
