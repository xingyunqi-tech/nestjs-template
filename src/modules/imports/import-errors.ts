import { HttpException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ImportRowError } from './domain/import-row-error';
import { SheetRow } from './package/sheet-row';

export type ErrorDescription = Pick<ImportRowError, 'field' | 'reason' | 'detail'>;

const FIELD_COLUMNS: Readonly<Record<string, string>> = {
  knowledgePointIds: 'knowledgePath',
  audioFileId: 'audio',
  parentId: 'materialKey',
  sort: 'order',
  questions: 'paper_questions',
  sections: 'sectionTitle',
  subjectId: 'subject',
};

export function columnOf(field: string): string {
  return FIELD_COLUMNS[field] ?? field;
}

/** 业务异常转为错误行描述；非业务异常返回 null，由调用方中止任务 */
export function describeException(error: unknown): ErrorDescription | null {
  if (error instanceof BusinessException) {
    return { field: error.errorKey === 'answerChangeNotAllowed' ? 'answer' : '', reason: error.errorKey };
  }
  if (!(error instanceof HttpException)) {
    return null;
  }
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const { error: key, errors } = response as { error?: unknown; errors?: Record<string, unknown> };
    const entries = Object.entries(errors ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (typeof key === 'string') {
      const detail = entries.map(([name, value]) => `${name}=${value}`).join(', ');
      return { field: '', reason: key, ...(detail && { detail }) };
    }
    if (entries.length > 0) {
      const [field, reason] = entries[0];
      return { field: columnOf(field), reason };
    }
  }
  return { field: '', reason: error.message };
}

export function describeValidationErrors(errors: ValidationError[]): ErrorDescription[] {
  return errors.flatMap((error) =>
    error.children?.length
      ? describeValidationErrors(error.children).map((child) => ({
          ...child,
          field: child.field || columnOf(error.property),
        }))
      : [
          {
            field: /^\d+$/.test(error.property) ? '' : columnOf(error.property),
            reason: 'invalidImportValue',
            detail: Object.keys(error.constraints ?? {}).join(', '),
          },
        ],
  );
}

/** 本单元内抛出，表示错误已记录、单元失败 */
export class UnitFailure extends Error {
  constructor() {
    super('Import unit failed');
  }
}

/** 收集一个导入单元的错误行，单元内全部行检查完后统一判定 */
export class UnitIssues {
  readonly errors: ImportRowError[] = [];

  add(row: SheetRow, field: string, reason: string, detail?: string): void {
    if (this.has(row, field)) {
      return;
    }
    this.errors.push({ sheet: row.sheet, row: row.row, field, reason, ...(detail && { detail }) });
  }

  addDescription(row: SheetRow, description: ErrorDescription): void {
    this.add(row, description.field, description.reason, description.detail);
  }

  has(row: SheetRow, field: string): boolean {
    return this.errors.some((error) => error.sheet === row.sheet && error.row === row.row && error.field === field);
  }

  get failed(): boolean {
    return this.errors.length > 0;
  }
}
