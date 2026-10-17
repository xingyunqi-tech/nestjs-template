import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from '@prometheus-io/client';
import { AdminAlertRepository } from './infrastructure/persistence/admin-alert.repository';
import { AdminAlert, AlertLevel } from './domain/admin-alert';
import { QueryAdminAlertDto } from './dto/query-admin-alert.dto';
import { ALERT_RECIPIENT_LIMIT } from './monitor.constants';
import { UsersService } from '../../core/users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory, NotificationChannel, NotificationType } from '../notifications/domain/notification';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { AlertReporter } from '../../infrastructure/alerting/alert-reporter';

const NOTIFICATION_TYPE_BY_LEVEL: Record<AlertLevel, NotificationType> = {
  [AlertLevel.INFO]: NotificationType.INFO,
  [AlertLevel.WARN]: NotificationType.WARNING,
  [AlertLevel.CRITICAL]: NotificationType.ERROR,
};

@Injectable()
export class AlertService implements AlertReporter {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly alertRepository: AdminAlertRepository,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    @InjectMetric('admin_alerts_total') private readonly raisedTotal: Counter<string>,
    @InjectMetric('admin_alerts_deduplicated_total') private readonly deduplicatedTotal: Counter<string>,
  ) {}

  /** 同一 dedupKey 已有未确认告警或写入失败时返回 null，不抛错 */
  async raise(
    type: string,
    level: AlertLevel,
    message: string,
    payload: Record<string, unknown> | null = null,
    dedupKey: string = type,
  ): Promise<AdminAlert | null> {
    let alert: AdminAlert | null;
    try {
      alert = await this.alertRepository.createIfNoOpen({ type, level, message, payload, dedupKey });
    } catch (error) {
      this.logger.error(`Failed to record alert ${dedupKey}: ${error instanceof Error ? error.message : error}`);
      return null;
    }

    if (!alert) {
      this.deduplicatedTotal.inc({ type });
      return null;
    }

    this.raisedTotal.inc({ type, level });
    this.logger.warn(`Alert raised [${level}] ${type}: ${message}`);
    await this.notifyAdmins(alert);
    return alert;
  }

  findManyWithPaginationAndCount(options: {
    filterOptions?: Pick<QueryAdminAlertDto, 'acknowledged' | 'level' | 'type'> | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: AdminAlert[]; total: number }> {
    return this.alertRepository.findManyWithPaginationAndCount(options);
  }

  async acknowledge(id: AdminAlert['id']): Promise<AdminAlert> {
    const alert = await this.alertRepository.acknowledge(id);
    if (!alert) {
      throw new NotFoundException({ error: 'alertNotFound' });
    }
    return alert;
  }

  private async notifyAdmins(alert: AdminAlert): Promise<void> {
    try {
      const admins = await this.usersService.findManyWithPagination({
        filterOptions: { roles: [{ id: RoleEnum.admin }] },
        paginationOptions: { page: 1, limit: ALERT_RECIPIENT_LIMIT },
      });
      for (const admin of admins) {
        await this.notificationsService.create({
          userId: Number(admin.id),
          type: NOTIFICATION_TYPE_BY_LEVEL[alert.level],
          category: NotificationCategory.SYSTEM,
          title: `[${alert.level}] ${alert.type}`.slice(0, 200),
          content: alert.message,
          metadata: { alertId: alert.id, dedupKey: alert.dedupKey },
          channels: [NotificationChannel.IN_APP],
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to notify admins of alert ${alert.id}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
