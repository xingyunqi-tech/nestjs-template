import { HttpStatus, UnprocessableEntityException, NotFoundException } from '@nestjs/common';

/**
 * Error response structure for validation errors
 */
export interface ValidationErrorResponse {
  status: number;
  errors: Record<string, string | Record<string, unknown>>;
}

/**
 * Throw a validation error with UnprocessableEntityException (422)
 * @param field - The field name that has the error
 * @param error - The error code/message
 */
export function throwValidationError(field: string, error: string): never {
  throw new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors: { [field]: error },
  });
}

/**
 * Throw a validation error with multiple fields
 * @param errors - Object containing field names and their error codes
 */
export function throwValidationErrors(errors: Record<string, string>): never {
  throw new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors,
  });
}

/**
 * Create an UnprocessableEntityException without throwing
 * Useful when you need to throw in a different context
 * @param field - The field name that has the error
 * @param error - The error code/message
 */
export function createValidationError(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors: { [field]: error },
  });
}

/**
 * Throw a not found error with NotFoundException (404)
 * @param error - The error code/message
 */
export function throwNotFoundError(error: string): never {
  throw new NotFoundException({
    status: HttpStatus.NOT_FOUND,
    error,
  });
}

/**
 * Create a NotFoundException without throwing
 * @param error - The error code/message
 */
export function createNotFoundError(error: string): NotFoundException {
  return new NotFoundException({
    status: HttpStatus.NOT_FOUND,
    error,
  });
}

/**
 * PostgreSQL unique constraint violation error code
 */
export const PG_UNIQUE_VIOLATION = '23505';

/** 是否为数据库唯一约束冲突 */
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === PG_UNIQUE_VIOLATION;
}

export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function isForeignKeyViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === PG_FOREIGN_KEY_VIOLATION;
}

/** 是否为指定唯一约束的冲突 */
export function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  return isUniqueViolation(error) && (error as { constraint?: string }).constraint === constraint;
}

export interface UniqueViolationResponse {
  status: HttpStatus;
  /** 字段级错误码，状态为 422 时返回 */
  errors?: Record<string, string>;
  /** 业务错误码，用作 message 的翻译 key */
  error?: string;
}

/**
 * 按约束名把唯一约束冲突映射为与事前检查一致的响应；未登记的约束返回 409，
 * 服务端生成值的约束返回 500
 */
export const UNIQUE_CONSTRAINT_RESPONSES: Partial<Record<string, UniqueViolationResponse>> = {
  UQ_e12875dfb3b1d92d7d7c5377e22: { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { email: 'emailAlreadyExists' } },
  user_phone_key: { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { phone: 'phoneAlreadyExists' } },
  user_wechatOpenId_key: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors: { wechatOpenId: 'wechatOpenIdAlreadyExists' },
  },
  user_alipayOpenId_key: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors: { alipayOpenId: 'alipayOpenIdAlreadyExists' },
  },
  REL_75e2be4ce11d447ef43be0e374: { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { photo: 'alreadyExists' } },
  UQ_favorite_user_target: { status: HttpStatus.CONFLICT, error: 'alreadyFavorited' },
  UQ_order_orderNo: { status: HttpStatus.INTERNAL_SERVER_ERROR },
  UQ_share_shareCode: { status: HttpStatus.INTERNAL_SERVER_ERROR },
};

export function uniqueViolationResponse(constraint: string | undefined): UniqueViolationResponse {
  return (constraint ? UNIQUE_CONSTRAINT_RESPONSES[constraint] : undefined) ?? { status: HttpStatus.CONFLICT };
}
