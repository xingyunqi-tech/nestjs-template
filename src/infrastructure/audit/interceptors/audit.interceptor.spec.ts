import { Body, CallHandler, ExecutionContext, Param } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IsInt, IsString } from 'class-validator';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { Auditable } from '../decorators/auditable.decorator';
import { AuditAction } from '../domain/audit-log';
import { AuditService } from '../audit.service';

class ItemDto {
  @IsString()
  name: string;

  @IsInt()
  count: number;
}

class ItemsController {
  @Auditable({ action: AuditAction.CREATE, entityType: 'Item' })
  create(@Body() _dto: ItemDto): void {}

  @Auditable({ action: AuditAction.UPDATE, entityType: 'Item' })
  update(@Param('id') _id: string, @Body() _dto: ItemDto): void {}

  @Auditable({ action: AuditAction.COPY, entityType: 'Item', entityIdFrom: 'response' })
  copy(@Param('id') _id: string): void {}

  @Auditable({ action: AuditAction.UPDATE, entityType: 'Item', idParam: ['id', 'date'], includeBody: false })
  regenerate(@Param('id') _id: string, @Param('date') _date: string): void {}

  @Auditable({
    action: AuditAction.UPDATE,
    entityType: 'Item',
    summarizeBody: (dto: ItemDto, params) => ({ id: params.id, count: dto.count }),
  })
  summarize(@Param('id') _id: string, @Body() _dto: ItemDto): void {}
}

type Handler = keyof ItemsController;

async function intercept(
  handler: Handler,
  request: { params?: Record<string, string>; body?: unknown },
  response: unknown,
): Promise<Parameters<AuditService['log']>[0]> {
  const log = vi.fn().mockResolvedValue(undefined);
  const interceptor = new AuditInterceptor(new Reflector(), { log } as unknown as AuditService);
  const context = {
    getClass: () => ItemsController,
    getHandler: () => ItemsController.prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ params: {}, body: {}, user: { id: 7 }, ...request }) }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(response) };

  await lastValueFrom(interceptor.intercept(context, next));
  await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
  return log.mock.calls[0][0];
}

const wrapped = (data: unknown) => ({ code: 200, message: 'success', data });

describe('AuditInterceptor', () => {
  it('should take the entity id from the wrapped response when the route has no id', async () => {
    const entry = await intercept('create', { body: { name: 'a', count: 1 } }, wrapped({ id: 'new-id' }));

    expect(entry).toMatchObject({ userId: 7, action: AuditAction.CREATE, entityType: 'Item', entityId: 'new-id' });
  });

  it('should prefer the route id and fall back to unknown', async () => {
    const byParam = await intercept('update', { params: { id: 'p1' }, body: { name: 'a', count: 1 } }, { id: 'r1' });
    const none = await intercept('create', { body: { name: 'a', count: 1 } }, wrapped(null));

    expect(byParam.entityId).toBe('p1');
    expect(none.entityId).toBe('unknown');
  });

  it('should prefer the response id when configured', async () => {
    const entry = await intercept('copy', { params: { id: 'source' } }, wrapped({ id: 'copy' }));

    expect(entry.entityId).toBe('copy');
  });

  it('should join several route parameters into the entity id', async () => {
    const entry = await intercept('regenerate', { params: { id: 's1', date: '2026-10-20' } }, wrapped({}));

    expect(entry).toMatchObject({ entityId: 's1:2026-10-20', newValue: null });
  });

  it('should record the validated body without unknown fields', async () => {
    const entry = await intercept('create', { body: { name: 'a', count: 1, extra: 'x' } }, wrapped({ id: 'n' }));

    expect(entry.newValue).toEqual({ name: 'a', count: 1 });
  });

  it('should record the summary instead of the body', async () => {
    const entry = await intercept('summarize', { params: { id: 'p1' }, body: { name: 'long', count: 3 } }, {});

    expect(entry.newValue).toEqual({ id: 'p1', count: 3 });
  });
});
