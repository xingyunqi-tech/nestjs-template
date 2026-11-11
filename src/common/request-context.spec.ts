import type { NextFunction, Request, Response } from 'express';
import { currentRequestContext, requestContextMiddleware, resolveRequestId } from './request-context';

function createRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: { ...headers },
    ip: '203.0.113.7',
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe('resolveRequestId', () => {
  it('should keep a well-formed incoming request id', () => {
    expect(resolveRequestId(createRequest({ 'x-request-id': 'abc-123_x.y:z' }))).toBe('abc-123_x.y:z');
  });

  it('should replace a malformed request id and write the new one to the request headers', () => {
    const req = createRequest({ 'x-request-id': 'bad id\n' });

    const id = resolveRequestId(req);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers['x-request-id']).toBe(id);
  });

  it('should return the same id when called again for the same request', () => {
    const req = createRequest();

    expect(resolveRequestId(req)).toBe(resolveRequestId(req));
  });
});

describe('requestContextMiddleware', () => {
  it('should echo the request id and expose the client info to the rest of the request', () => {
    const req = createRequest({ 'x-request-id': 'req-1', 'user-agent': 'UA/1.0' });
    const setHeader = vi.fn();
    let seen: ReturnType<typeof currentRequestContext>;
    const next: NextFunction = () => {
      seen = currentRequestContext();
    };

    requestContextMiddleware(req, { setHeader } as unknown as Response, next);

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-1');
    expect(seen).toEqual({ requestId: 'req-1', ip: '203.0.113.7', userAgent: 'UA/1.0' });
    expect(currentRequestContext()).toBeUndefined();
  });
});
