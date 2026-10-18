import { NullableType } from '../../../../common/types/nullable.type';
import { Notification, NotificationCategory, NotificationChannel, NotificationType } from '../../domain/notification';
import { TransactionHandle } from '../../../../common/database/transaction-handle';
import { DeepPartial } from '../../../../common/types/deep-partial.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { QueryNotificationDto } from '../../dto/query-notification.dto';

export interface InAppBatch {
  userIds: number[];
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

/** 带 userId 的查询只返回投递渠道包含站内信的通知 */
export abstract class NotificationRepository {
  /** 事务内为多个用户写入同一条站内信，跳过关闭了该分类站内信的用户，返回写入数 */
  abstract insertInAppBatch(handle: TransactionHandle, batch: InAppBatch): Promise<number>;

  abstract create(data: Omit<Notification, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Notification>;

  abstract findManyWithPagination({
    userId,
    filterOptions,
    paginationOptions,
  }: {
    userId: Notification['userId'];
    filterOptions?: QueryNotificationDto | null;
    paginationOptions: IPaginationOptions;
  }): Promise<Notification[]>;

  abstract findById(id: Notification['id']): Promise<NullableType<Notification>>;

  abstract findByIdAndUserId(
    id: Notification['id'],
    userId: Notification['userId'],
  ): Promise<NullableType<Notification>>;

  abstract update(id: Notification['id'], payload: DeepPartial<Notification>): Promise<Notification | null>;

  abstract markAsRead(id: Notification['id'], userId: Notification['userId']): Promise<Notification | null>;

  abstract markAllAsRead(userId: Notification['userId']): Promise<void>;

  /** 原子写入单个渠道的发送结果，不覆盖其他渠道 */
  abstract recordChannelResult(
    id: Notification['id'],
    channel: NotificationChannel,
    result: Notification['sentChannels'][string],
  ): Promise<void>;

  abstract countUnreadByUserId(userId: Notification['userId']): Promise<number>;

  abstract countUnreadByCategory(userId: Notification['userId']): Promise<Record<string, number>>;

  abstract countByUserId(userId: Notification['userId'], filterOptions?: QueryNotificationDto | null): Promise<number>;

  abstract remove(id: Notification['id']): Promise<void>;
}
