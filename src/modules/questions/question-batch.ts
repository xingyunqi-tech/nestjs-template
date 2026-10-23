import { HttpException } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { STATUS_TO_I18N_KEY } from '../../common/filters/all-exceptions.filter';
import { BatchQuestionFailureDto } from './dto/batch-question-operation.dto';

const INTERNAL_ERROR_KEY = 'internalServerError';

/** 异常的 error 码，其次取字段错误码，再按状态码兜底 */
export function batchErrorKeyOf(error: unknown): string {
  if (!(error instanceof HttpException)) {
    return INTERNAL_ERROR_KEY;
  }
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const { error: code, errors } = response as { error?: unknown; errors?: unknown };
    if (typeof code === 'string' && /^[a-z][A-Za-z0-9]*$/.test(code)) {
      return code;
    }
    const fieldCode =
      typeof errors === 'object' && errors !== null
        ? Object.values(errors).find((value): value is string => typeof value === 'string')
        : undefined;
    if (fieldCode) {
      return fieldCode;
    }
  }
  return STATUS_TO_I18N_KEY[error.getStatus()] ?? INTERNAL_ERROR_KEY;
}

function translate(key: string, i18n: I18nContext | undefined): string {
  const translated = i18n?.t(`common.${key}`, { defaultValue: '' });
  return typeof translated === 'string' && translated !== '' && translated !== `common.${key}` ? translated : key;
}

export function toBatchFailure(id: string, error: unknown): BatchQuestionFailureDto {
  const key = batchErrorKeyOf(error);
  return { id, error: key, message: translate(key, I18nContext.current()) };
}
