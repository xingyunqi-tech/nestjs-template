import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../audit.service';
import { AUDITABLE_KEY, AuditableOptions } from '../decorators/auditable.decorator';
import { RequestWithUser } from '../../../common/types/request-with-user.type';
import validationOptions from '../../../common/validation-options';

interface RouteArgMetadata {
  index: number;
  data?: string;
}

interface BodyParam {
  metatype: Type<unknown> | undefined;
  data: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** ResponseInterceptor 包装后的 { code, message, data } 取 data */
export function unwrapResponse(response: unknown): unknown {
  if (isRecord(response) && typeof response.code === 'number' && 'message' in response && 'data' in response) {
    return response.data;
  }
  return response;
}

function responseIdOf(response: unknown): string | undefined {
  const data = unwrapResponse(response);
  const id = isRecord(data) ? data.id : undefined;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

function paramIdOf(
  params: Record<string, string | string[] | undefined>,
  idParam: string | string[],
): string | undefined {
  const values = (Array.isArray(idParam) ? idParam : [idParam]).map((name) => {
    const value = params[name];
    return Array.isArray(value) ? value.join('/') : value;
  });
  return values.every((value) => value !== undefined && value !== '') ? values.join(':') : undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  private readonly validationPipe = new ValidationPipe(validationOptions);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditOptions = this.reflector.get<AuditableOptions>(AUDITABLE_KEY, context.getHandler());

    if (!auditOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const { action, entityType, idParam = 'id', entityIdFrom = 'param', includeResponse } = auditOptions;
    const params = request.params as Record<string, string | string[] | undefined>;
    const paramId = paramIdOf(params, idParam);
    const userId = request.user?.id ?? null;

    return next.handle().pipe(
      tap({
        next: (response) => {
          const responseId = responseIdOf(response);
          const entityId =
            (entityIdFrom === 'response' ? (responseId ?? paramId) : (paramId ?? responseId)) ?? 'unknown';
          const responseValue = unwrapResponse(response);
          this.recordedBody(context, auditOptions)
            .then((body) =>
              this.auditService.log({
                userId,
                action,
                entityType,
                entityId,
                oldValue: null,
                newValue: includeResponse && isRecord(responseValue) ? responseValue : body,
                request,
              }),
            )
            .catch((error) => {
              this.logger.error('Failed to create audit log', error);
            });
        },
        error: (error) => {
          this.logger.debug(`Operation failed for ${action} on ${entityType}:${paramId ?? 'unknown'}`, {
            error: error?.message,
          });
        },
      }),
    );
  }

  private async recordedBody(
    context: ExecutionContext,
    { includeBody, summarizeBody }: AuditableOptions,
  ): Promise<Record<string, unknown> | null> {
    if (!includeBody && !summarizeBody) {
      return null;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const body = await this.validatedBody(context, request.body);
    if (summarizeBody) {
      return summarizeBody(body, request.params as Record<string, string>);
    }
    return isRecord(body) ? { ...body } : null;
  }

  /** 与全局 ValidationPipe 相同的转换与白名单过滤，得到处理函数收到的 DTO */
  private async validatedBody(context: ExecutionContext, rawBody: unknown): Promise<unknown> {
    const param = this.bodyParamOf(context);
    if (!param) {
      return rawBody;
    }
    const value = param.data && isRecord(rawBody) ? rawBody[param.data] : rawBody;
    try {
      return await this.validationPipe.transform(value, { type: 'body', metatype: param.metatype, data: param.data });
    } catch {
      return value;
    }
  }

  private bodyParamOf(context: ExecutionContext): BodyParam | undefined {
    const controller = context.getClass();
    const handlerName = context.getHandler().name;
    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<
      string,
      RouteArgMetadata
    >;
    const entry = Object.entries(args).find(([key]) => key.split(':')[0] === String(RouteParamtypes.BODY));
    if (!entry) {
      return undefined;
    }
    const paramTypes = (Reflect.getMetadata('design:paramtypes', controller.prototype, handlerName) ??
      []) as Type<unknown>[];
    return { metatype: paramTypes[entry[1].index], data: entry[1].data };
  }
}
