import type { Mocked } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Counter } from '@prometheus-io/client';
import { AlertService } from './alert.service';
import { AdminAlertRepository } from './infrastructure/persistence/admin-alert.repository';
import { AdminAlert, AlertLevel } from './domain/admin-alert';
import { UsersService } from '../../core/users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory, NotificationChannel, NotificationType } from '../notifications/domain/notification';
import { RoleEnum } from '../../common/enums/roles/roles.enum';

function alert(overrides: Partial<AdminAlert> = {}): AdminAlert {
  return Object.assign(new AdminAlert(), {
    id: 1,
    type: 'auto-submit',
    level: AlertLevel.WARN,
    message: '自动交卷延迟',
    payload: null,
    dedupKey: 'auto-submit-delay',
    acknowledgedAt: null,
    ...overrides,
  });
}

describe('AlertService', () => {
  let repository: Mocked<AdminAlertRepository>;
  let usersService: { findManyWithPagination: ReturnType<typeof vi.fn> };
  let notificationsService: { create: ReturnType<typeof vi.fn> };
  let raisedTotal: { inc: ReturnType<typeof vi.fn> };
  let deduplicatedTotal: { inc: ReturnType<typeof vi.fn> };
  let service: AlertService;

  beforeEach(() => {
    repository = {
      createIfNoOpen: vi.fn(),
      findById: vi.fn(),
      findManyWithPaginationAndCount: vi.fn(),
      acknowledge: vi.fn(),
    };
    usersService = { findManyWithPagination: vi.fn().mockResolvedValue([{ id: 1 }, { id: 3 }]) };
    notificationsService = { create: vi.fn().mockResolvedValue({}) };
    raisedTotal = { inc: vi.fn() };
    deduplicatedTotal = { inc: vi.fn() };
    service = new AlertService(
      repository,
      usersService as unknown as UsersService,
      notificationsService as unknown as NotificationsService,
      raisedTotal as unknown as Counter<string>,
      deduplicatedTotal as unknown as Counter<string>,
    );
  });

  it('should record a new alert and notify every admin in app', async () => {
    repository.createIfNoOpen.mockResolvedValue(alert());

    await expect(
      service.raise('auto-submit', AlertLevel.WARN, '自动交卷延迟', { sessionId: 9 }, 'auto-submit-delay'),
    ).resolves.toMatchObject({ id: 1 });

    expect(repository.createIfNoOpen).toHaveBeenCalledWith({
      type: 'auto-submit',
      level: AlertLevel.WARN,
      message: '自动交卷延迟',
      payload: { sessionId: 9 },
      dedupKey: 'auto-submit-delay',
    });
    expect(usersService.findManyWithPagination).toHaveBeenCalledWith(
      expect.objectContaining({ filterOptions: { roles: [{ id: RoleEnum.admin }] } }),
    );
    expect(notificationsService.create).toHaveBeenCalledTimes(2);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        type: NotificationType.WARNING,
        category: NotificationCategory.SYSTEM,
        channels: [NotificationChannel.IN_APP],
      }),
    );
    expect(raisedTotal.inc).toHaveBeenCalledWith({ type: 'auto-submit', level: AlertLevel.WARN });
  });

  it('should use the type as dedup key by default', async () => {
    repository.createIfNoOpen.mockResolvedValue(alert());
    await service.raise('import', AlertLevel.CRITICAL, '导入失败');
    expect(repository.createIfNoOpen).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'import' }));
  });

  it('should not record or notify again while the same alert is open', async () => {
    repository.createIfNoOpen.mockResolvedValue(null);

    await expect(service.raise('auto-submit', AlertLevel.WARN, '自动交卷延迟')).resolves.toBeNull();

    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(deduplicatedTotal.inc).toHaveBeenCalledWith({ type: 'auto-submit' });
    expect(raisedTotal.inc).not.toHaveBeenCalled();
  });

  it('should not throw when recording fails', async () => {
    repository.createIfNoOpen.mockRejectedValue(new Error('db down'));
    await expect(service.raise('ai', AlertLevel.CRITICAL, '熔断')).resolves.toBeNull();
  });

  it('should keep the alert when notifying admins fails', async () => {
    repository.createIfNoOpen.mockResolvedValue(alert());
    notificationsService.create.mockRejectedValue(new Error('boom'));
    await expect(service.raise('ai', AlertLevel.CRITICAL, '熔断')).resolves.toMatchObject({ id: 1 });
  });

  it('should acknowledge an alert', async () => {
    const acknowledged = alert({ acknowledgedAt: new Date() });
    repository.acknowledge.mockResolvedValue(acknowledged);
    await expect(service.acknowledge(1)).resolves.toBe(acknowledged);
  });

  it('should return 404 when acknowledging a missing alert', async () => {
    repository.acknowledge.mockResolvedValue(null);
    await expect(service.acknowledge(1)).rejects.toBeInstanceOf(NotFoundException);
  });
});
