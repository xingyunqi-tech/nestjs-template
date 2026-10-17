export interface ImportRowError {
  sheet: string;
  /** xlsx 为表格行号（表头为第 1 行），JSON 为数组下标加 1 */
  row: number;
  field: string;
  reason: string;
  detail?: string;
}
