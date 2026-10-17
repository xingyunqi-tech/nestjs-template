import {
  ArgumentsHost,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { I18nContext } from 'nestjs-i18n';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { BusinessException } from '../exceptions/business.exception';

const TRANSLATIONS: Record<string, string> = {
  'common.favoriteNotFound': '收藏不存在',
  'common.unauthorized': '未授权',
  'common.forbidden': '禁止访问',
  'common.conflict': '资源冲突',
  'common.emailAlreadyExists': '邮箱已被注册',
  'common.alreadyFavorited': '已收藏',
  'common.internalServerError': '服务器内部错误',
  'common.sessionTakenOver': '考试已在其他设备继续',
};

function run(exception: unknown): { body: { code: number; message: unknown; data: unknown }; status: number } {
  const reply = vi.fn();
  const filter = new AllExceptionsFilter({
    httpAdapter: { reply, getRequestUrl: () => '/test' },
  } as unknown as HttpAdapterHost);
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);

  const [, body, status] = reply.mock.calls[0];
  return { body, status };
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    vi.spyOn(I18nContext, 'current').mockReturnValue({
      t: (key: string) => TRANSLATIONS[key] ?? key,
    } as unknown as I18nContext<unknown>);
  });

  afterEach(() => vi.restoreAllMocks());

  it('should translate the business error code into the message', () => {
    const { body, status } = run(new NotFoundException({ error: 'favoriteNotFound' }));
    expect(status).toBe(404);
    expect(body.message).toBe('收藏不存在');
  });

  it('should return the error code when it has no translation', () => {
    expect(run(new NotFoundException({ error: 'orderNotFound' })).body.message).toBe('orderNotFound');
  });

  it('should translate the default message of a built-in exception', () => {
    expect(run(new UnauthorizedException()).body.message).toBe('未授权');
  });

  it('should translate a built-in exception created with its default description', () => {
    expect(run(new ForbiddenException('Forbidden')).body.message).toBe('禁止访问');
    expect(run(new ConflictException()).body.message).toBe('资源冲突');
  });

  const uniqueViolation = (constraint: string): QueryFailedError =>
    new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate'), { code: '23505', constraint }));

  it('should answer a duplicate email like the registration pre-check', () => {
    const { body, status } = run(uniqueViolation('UQ_e12875dfb3b1d92d7d7c5377e22'));
    expect(status).toBe(422);
    expect(body.data).toEqual({ email: '邮箱已被注册' });
  });

  it('should answer a duplicate favorite like the favorite pre-check', () => {
    const { body, status } = run(uniqueViolation('UQ_favorite_user_target'));
    expect(status).toBe(409);
    expect(body.message).toBe('已收藏');
  });

  it('should treat a collision on a server-generated value as a server error', () => {
    expect(run(uniqueViolation('UQ_order_orderNo')).status).toBe(500);
  });

  it('should answer an unregistered unique constraint with 409', () => {
    const { body, status } = run(uniqueViolation('UQ_notification_setting_userId_category'));
    expect(status).toBe(409);
    expect(body.message).toBe('资源冲突');
  });

  it('should keep other database errors as 500', () => {
    const exception = new QueryFailedError('INSERT', [], Object.assign(new Error('boom'), { code: '22001' }));
    expect(run(exception).status).toBe(500);
  });

  it('should keep a custom message of a built-in exception', () => {
    expect(run(new NotFoundException('Share not found')).body.message).toBe('Share not found');
  });

  it('should return the business error key untranslated in data with a translated message', () => {
    const { body, status } = run(new BusinessException('sessionTakenOver'));
    expect(status).toBe(409);
    expect(body.message).toBe('考试已在其他设备继续');
    expect(body.data).toEqual({ errorKey: 'sessionTakenOver' });
  });

  it('should keep business error details untranslated', () => {
    const { body, status } = run(new BusinessException('aiQuotaExceeded', { remaining: 0, reason: 'conflict' }));
    expect(status).toBe(429);
    expect(body.data).toEqual({ remaining: 0, reason: 'conflict', errorKey: 'aiQuotaExceeded' });
  });
});
