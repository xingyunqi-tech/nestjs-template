import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** 沿用格式合法的入站 X-Request-Id，否则生成新值并写回请求头 */
export function resolveRequestId(req: { headers: IncomingHttpHeaders }): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)) {
    return incoming;
  }
  const requestId = randomUUID();
  req.headers[REQUEST_ID_HEADER] = requestId;
  return requestId;
}

/** 在响应头回写 X-Request-Id，并在本次请求的异步链路内提供 RequestContext */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  storage.run({ requestId, ip: req.ip, userAgent: req.get('user-agent') }, next);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
