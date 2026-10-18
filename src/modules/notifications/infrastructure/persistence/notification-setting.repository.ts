import { NullableType } from '../../../../common/types/nullable.type';
import { NotificationSetting } from '../../domain/notification-setting';
import { DeepPartial } from '../../../../common/types/deep-partial.type';
import { NotificationCategory } from '../../domain/notification';

export abstract class NotificationSettingRepository {
  abstract create(data: Omit<NotificationSetting, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationSetting>;

  abstract findByUserIdAndCategory(
    userId: NotificationSetting['userId'],
    category: NotificationCategory,
  ): Promise<NullableType<NotificationSetting>>;

  abstract findAllByUserId(userId: NotificationSetting['userId']): Promise<NotificationSetting[]>;

  abstract update(
    userId: NotificationSetting['userId'],
    category: NotificationCategory,
    payload: DeepPartial<NotificationSetting>,
  ): Promise<NotificationSetting | null>;

  abstract initializeDefaultSettings(userId: NotificationSetting['userId']): Promise<void>;

  abstract removeByUser(userId: number): Promise<void>;
}
