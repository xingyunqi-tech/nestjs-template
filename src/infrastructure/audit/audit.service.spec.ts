import { AuditService } from './audit.service';
import { AuditLogRepository } from './infrastructure/persistence/audit-log.repository';

describe('AuditService', () => {
  it('should redact sensitive fields regardless of their case and nesting', async () => {
    const create = vi.fn().mockImplementation(async (data: unknown) => data);
    const service = new AuditService({ create } as unknown as AuditLogRepository);

    await service.log({
      action: 'UPDATE',
      entityType: 'user',
      entityId: '1',
      newValue: {
        oldPassword: 'a',
        refreshToken: 'b',
        code: '110101',
        hash: 'h',
        name: 'kept',
        nested: { accessToken: 'c', apiKey: 'd', sessionKey: 'e', passwordHash: 'f' },
      },
    } as Parameters<AuditService['log']>[0]);

    expect(create.mock.calls[0][0].newValue).toEqual({
      oldPassword: '[REDACTED]',
      refreshToken: '[REDACTED]',
      code: '110101',
      hash: '[REDACTED]',
      name: 'kept',
      nested: {
        accessToken: '[REDACTED]',
        apiKey: '[REDACTED]',
        sessionKey: '[REDACTED]',
        passwordHash: '[REDACTED]',
      },
    });
  });

  it('should record dates as ISO strings and keep nested arrays', async () => {
    const create = vi.fn().mockImplementation(async (data: unknown) => data);
    const service = new AuditService({ create } as unknown as AuditLogRepository);
    const at = new Date('2026-01-02T03:04:05.000Z');

    await service.log({
      action: 'UPDATE',
      entityType: 'Question',
      entityId: '1',
      newValue: { at, nested: { at }, list: [at], blanks: [['甲'], ['乙', '丙']] },
    } as Parameters<AuditService['log']>[0]);

    expect(create.mock.calls[0][0].newValue).toEqual({
      at: '2026-01-02T03:04:05.000Z',
      nested: { at: '2026-01-02T03:04:05.000Z' },
      list: ['2026-01-02T03:04:05.000Z'],
      blanks: [['甲'], ['乙', '丙']],
    });
  });
});
