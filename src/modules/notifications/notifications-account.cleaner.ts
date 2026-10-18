import { Injectable } from '@nestjs/common';
import { NotificationRepository } from './infrastructure/persistence/notification.repository';
import { NotificationSettingRepository } from './infrastructure/persistence/notification-setting.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 100 })
@Injectable()
export class NotificationsAccountCleaner implements AccountDataCleaner {
  readonly name = 'notifications';

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationSettingRepository: NotificationSettingRepository,
  ) {}

  async clean(userId: number): Promise<void> {
    await this.notificationRepository.removeByUser(userId);
    await this.notificationSettingRepository.removeByUser(userId);
  }
}
