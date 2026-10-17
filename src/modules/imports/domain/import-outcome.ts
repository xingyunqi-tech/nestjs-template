import { ImportRowError } from './import-row-error';

export interface ImportProgress {
  total: number;
  succeeded: number;
  failed: number;
  /** 内容已存在、未写入的单元 */
  skipped: number;
}

export interface ImportOutcome extends ImportProgress {
  errors: ImportRowError[];
}
