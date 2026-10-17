import { HttpException } from '@nestjs/common';
import { BUSINESS_ERRORS, BUSINESS_ERROR_KEY_FIELD, BusinessErrorKey } from '../constants/business-error-keys';

/** 以业务错误键抛出的异常，响应为 `{ code, message, data: { errorKey, ...details } }` */
export class BusinessException extends HttpException {
  readonly errorKey: BusinessErrorKey;

  constructor(errorKey: BusinessErrorKey, details?: Record<string, unknown>) {
    super({ error: errorKey, errors: { ...details, [BUSINESS_ERROR_KEY_FIELD]: errorKey } }, BUSINESS_ERRORS[errorKey]);
    this.errorKey = errorKey;
  }
}
