import { basename, join } from 'path';

export const LOCAL_FILES_ROOT = './files';

export function localFileUrlPath(apiPrefix: string | undefined, fileName: string): string {
  return `/${apiPrefix}/v1/files/${fileName}`;
}

export function localDiskPath(path: string): string {
  return join(LOCAL_FILES_ROOT, basename(path));
}
