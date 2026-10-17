import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { I18nContext } from 'nestjs-i18n';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiErrorResponse } from '../dto/api-response.dto';
import { DEFAULT_EXCEPTION_MESSAGES } from './exception-messages.constant';
import { isUniqueViolation, uniqueViolationResponse } from '../utils/exceptions.util';
import { BusinessException } from '../exceptions/business.exception';

/**
 * Map HTTP status codes to i18n keys
 */
const STATUS_TO_I18N_KEY: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'badRequest',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'notFound',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.GONE]: 'gone',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'unprocessableEntity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'tooManyRequests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'internalServerError',
};

/** Nest 内置异常未传参时使用的默认 message */
const DEFAULT_DESCRIPTIONS = [
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Gone',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
];

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const i18n = I18nContext.current(host);

    const requestId = request.headers['x-request-id'] as string | undefined;
    const path = httpAdapter.getRequestUrl(request);

    let statusCode: number;
    let message: string | string[];
    let error: string;
    let errors: Record<string, unknown> | undefined;

    if (exception instanceof ThrottlerException) {
      statusCode = HttpStatus.TOO_MANY_REQUESTS;
      message = this.translateMessage('tooManyRequests', i18n) ?? DEFAULT_EXCEPTION_MESSAGES.TOO_MANY_REQUESTS;
      error = 'Too Many Requests';
    } else if (isUniqueViolation(exception)) {
      const { constraint, detail } = exception as { constraint?: string; detail?: string };
      const mapped = uniqueViolationResponse(constraint);
      statusCode = mapped.status;
      error = `Unique constraint violation ${constraint ?? 'unknown'} ${detail ?? ''}`.trim();
      message = mapped.error
        ? (this.translateMessage(mapped.error, i18n) ?? mapped.error)
        : this.getDefaultMessage(statusCode, i18n);
      if (mapped.errors) {
        errors = i18n ? this.translateErrors(mapped.errors, i18n) : mapped.errors;
      }
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        message = this.translateMessage(response, i18n) ?? response;
        error = exception.name;
      } else if (typeof response === 'object' && response !== null) {
        const responseObj = response as Record<string, unknown>;
        errors = responseObj.errors as Record<string, unknown> | undefined;

        // Get message from response or use status-based default
        const rawMessage = responseObj.message as string | string[] | undefined;
        const rawError = typeof responseObj.error === 'string' ? responseObj.error : undefined;
        const errorCode = rawError && !DEFAULT_DESCRIPTIONS.includes(rawError) ? rawError : undefined;
        message = this.getTranslatedMessage(rawMessage, statusCode, i18n, errorCode);

        error = rawError ?? exception.name;

        // Translate error codes in errors object
        if (errors && i18n && !(exception instanceof BusinessException)) {
          errors = this.translateErrors(errors, i18n);
        }
      } else {
        message = this.getDefaultMessage(statusCode, i18n);
        error = exception.name;
      }
    } else if (exception instanceof Error) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = this.translateMessage('internalServerError', i18n) ?? DEFAULT_EXCEPTION_MESSAGES.INTERNAL_SERVER_ERROR;
      error = 'Internal Server Error';

      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack, {
        path,
        requestId,
      });
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = this.translateMessage('internalServerError', i18n) ?? DEFAULT_EXCEPTION_MESSAGES.INTERNAL_SERVER_ERROR;
      error = 'Internal Server Error';

      this.logger.error(`Unknown exception type`, { exception, path, requestId });
    }

    const responseBody: ApiErrorResponse = {
      code: statusCode,
      message,
      data: errors ?? null,
    };

    if (statusCode >= 500) {
      this.logger.error(`${error}: ${JSON.stringify(message)}`, { path, requestId, statusCode });
    } else if (statusCode >= 400) {
      this.logger.warn(`${error}: ${JSON.stringify(message)}`, { path, requestId, statusCode });
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, statusCode);
  }

  /**
   * Translate a single message key
   */
  private translateMessage(key: string, i18n: I18nContext | undefined): string | undefined {
    if (!i18n) return undefined;
    const translated = i18n.t(`common.${key}`, { defaultValue: '' });
    return translated && translated !== `common.${key}` ? translated : undefined;
  }

  /**
   * Get default message based on HTTP status code
   */
  private getDefaultMessage(statusCode: number, i18n: I18nContext | undefined): string {
    const i18nKey = STATUS_TO_I18N_KEY[statusCode];
    if (i18nKey) {
      const translated = this.translateMessage(i18nKey, i18n);
      if (translated) return translated;
    }
    return HttpStatus[statusCode] || 'Error';
  }

  /**
   * Get translated message from raw message or use default
   */
  private getTranslatedMessage(
    rawMessage: string | string[] | undefined,
    statusCode: number,
    i18n: I18nContext | undefined,
    errorCode?: string,
  ): string | string[] {
    // If no message or it's the default NestJS exception message, use the error code or status-based default
    if (!rawMessage || this.isDefaultExceptionMessage(rawMessage)) {
      if (errorCode) {
        return this.translateMessage(errorCode, i18n) ?? errorCode;
      }
      return this.getDefaultMessage(statusCode, i18n);
    }

    // Try to translate if it's a string
    if (typeof rawMessage === 'string') {
      const translated = this.translateMessage(rawMessage, i18n);
      return translated ?? rawMessage;
    }

    // For array of messages (validation errors), translate each
    if (Array.isArray(rawMessage)) {
      return rawMessage.map((msg) => {
        const translated = this.translateMessage(msg, i18n);
        return translated ?? msg;
      });
    }

    return rawMessage;
  }

  /**
   * Check if message is a default NestJS exception message
   */
  private isDefaultExceptionMessage(message: string | string[]): boolean {
    if (typeof message !== 'string') return false;
    const defaultMessages = [
      'Bad Request Exception',
      'Unauthorized Exception',
      'Forbidden Exception',
      'Not Found Exception',
      'Unprocessable Entity Exception',
      'Internal Server Error Exception',
    ];
    return DEFAULT_DESCRIPTIONS.includes(message) || defaultMessages.some((m) => message.includes(m));
  }

  /**
   * Translate error codes in errors object
   */
  private translateErrors(errors: Record<string, unknown>, i18n: I18nContext): Record<string, unknown> {
    const translated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(errors)) {
      if (typeof value === 'string') {
        translated[key] = this.translateMessage(value, i18n) ?? value;
      } else {
        translated[key] = value;
      }
    }
    return translated;
  }
}
