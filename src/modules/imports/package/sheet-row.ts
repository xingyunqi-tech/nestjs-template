export const IMPORT_SHEETS = ['knowledge_points', 'materials', 'questions', 'papers', 'paper_questions'] as const;

export type ImportSheetName = (typeof IMPORT_SHEETS)[number];

export interface SheetRow {
  sheet: ImportSheetName;
  row: number;
  values: Record<string, string>;
  /** 单元格为日期的列 */
  dateColumns?: string[];
}

export type ImportSheets = Record<ImportSheetName, SheetRow[]>;

export function emptySheets(): ImportSheets {
  return { knowledge_points: [], materials: [], questions: [], papers: [], paper_questions: [] };
}

export function normalizeCellText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
