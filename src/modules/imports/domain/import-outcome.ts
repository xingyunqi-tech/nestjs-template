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

export const IMPORT_ENTITIES = ['knowledgePoints', 'materials', 'questions', 'papers'] as const;

/** knowledgePoints 为知识点行，materials 为材料连同小题，questions 为独立题 */
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportEntityCounts = Record<ImportEntity, number>;

export interface ImportSummary {
  created: ImportEntityCounts;
  updated: ImportEntityCounts;
  skipped: ImportEntityCounts;
}

export function emptyImportSummary(): ImportSummary {
  const counts = (): ImportEntityCounts => ({ knowledgePoints: 0, materials: 0, questions: 0, papers: 0 });
  return { created: counts(), updated: counts(), skipped: counts() };
}
