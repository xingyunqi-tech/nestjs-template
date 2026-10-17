import { fromBuffer, Entry, ZipFile } from 'yauzl';
import { ImportPackageError } from './import-package-error';

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const IGNORED_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, decodeStrings: false }, (error, zipfile) =>
      error ? reject(new ImportPackageError('importInvalidPackage')) : resolve(zipfile),
    );
  });
}

const UTF8_NAME_FLAG = 0x800;

/** 带 UTF-8 标记或能严格按 UTF-8 解码时按 UTF-8，否则按 GB18030 */
export function decodeEntryName(raw: Buffer, generalPurposeBitFlag: number): string {
  if (generalPurposeBitFlag & UTF8_NAME_FLAG) {
    return raw.toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('gb18030').decode(raw);
  }
}

export function normalizeEntryName(name: string): string | null {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return null;
  }
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  return segments.includes('..') ? null : segments.join('/');
}

function readEntry(zipfile: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(new ImportPackageError('importInvalidPackage'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy(new ImportPackageError('importPackageTooLarge'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (streamError) =>
        reject(
          streamError instanceof ImportPackageError ? streamError : new ImportPackageError('importInvalidPackage'),
        ),
      );
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

/** 解压到内存，限制条目数、单个条目与解压总大小 */
export async function readZipEntries(buffer: Buffer, limits: ZipLimits): Promise<Map<string, Buffer>> {
  const zipfile = await openZip(buffer);
  if (zipfile.entryCount > limits.maxEntries) {
    zipfile.close();
    throw new ImportPackageError('importTooManyEntries');
  }

  const entries = new Map<string, Buffer>();
  let totalBytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('error', () => reject(new ImportPackageError('importInvalidPackage')));
      zipfile.on('end', () => resolve());
      zipfile.on('entry', (entry: Entry) => {
        const fileName = decodeEntryName(entry.fileName as unknown as Buffer, entry.generalPurposeBitFlag);
        const name = normalizeEntryName(fileName);
        if (name === null) {
          reject(new ImportPackageError('importInvalidPackage'));
          return;
        }
        if (fileName.endsWith('/') || name === '' || IGNORED_ENTRY.test(name)) {
          zipfile.readEntry();
          return;
        }
        if (
          entry.uncompressedSize > limits.maxEntryBytes ||
          totalBytes + entry.uncompressedSize > limits.maxTotalBytes
        ) {
          reject(new ImportPackageError('importPackageTooLarge'));
          return;
        }
        readEntry(zipfile, entry, Math.min(limits.maxEntryBytes, limits.maxTotalBytes - totalBytes))
          .then((content) => {
            totalBytes += content.length;
            entries.set(name, content);
            zipfile.readEntry();
          })
          .catch(reject);
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
  return entries;
}
