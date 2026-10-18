import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Raw, Repository } from 'typeorm';
import { NotificationEntity } from '../entities/notification.entity';
import { InAppBatch, NotificationRepository } from '../../notification.repository';
import { NotificationMapper } from '../mappers/notification.mapper';
import { Notification, NotificationChannel } from '../../../../domain/notification';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { QueryNotificationDto } from '../../../../dto/query-notification.dto';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { DeepPartial } from '../../../../../../common/types/deep-partial.type';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

/** 用户可见的通知：投递渠道包含站内信 */
const inAppChannel = (): FindOptionsWhere<NotificationEntity>['channels'] =>
  Raw((alias) => `${alias} @> :inAppChannel`, { inAppChannel: JSON.stringify([NotificationChannel.IN_APP]) });

@Injectable()
export class NotificationRelationalRepository implements NotificationRepository {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
  ) {}

  async recordChannelResult(
    id: Notification['id'],
    channel: NotificationChannel,
    result: Notification['sentChannels'][string],
  ): Promise<void> {
    await this.notificationRepository
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ sentChannels: () => `"sentChannels" || CAST(:patch AS jsonb)` })
      .where('id = :id', { id: Number(id) })
      .andWhere('"deletedAt" IS NULL')
      .setParameter('patch', JSON.stringify({ [channel]: result }))
      .execute();
  }

  async insertInAppBatch(handle: TransactionHandle, batch: InAppBatch): Promise<number> {
    if (batch.userIds.length === 0) {
      return 0;
    }
    const rows: unknown[] = await entityManagerOf(handle).query(
      `INSERT INTO "notification" ("userId", "type", "category", "title", "content", "metadata", "channels")
       SELECT target."userId", $2::varchar, $3::varchar, $4::varchar, $5::text, $6::jsonb, $7::jsonb
       FROM unnest($1::int[]) AS target("userId")
       WHERE NOT EXISTS (
         SELECT 1 FROM "notification_setting" AS setting
         WHERE setting."userId" = target."userId" AND setting."category" = $3::varchar AND NOT setting."enableInApp"
       )
       RETURNING "id"`,
      [
        batch.userIds,
        batch.type,
        batch.category,
        batch.title,
        batch.content,
        batch.metadata === null ? null : JSON.stringify(batch.metadata),
        JSON.stringify([NotificationChannel.IN_APP]),
      ],
    );
    return rows.length;
  }

  async create(data: Omit<Notification, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Notification> {
    const persistenceModel = NotificationMapper.toPersistence(data);
    const newEntity = await this.notificationRepository.save(this.notificationRepository.create(persistenceModel));
    return NotificationMapper.toDomain(newEntity);
  }

  async findManyWithPagination({
    userId,
    filterOptions,
    paginationOptions,
  }: {
    userId: Notification['userId'];
    filterOptions?: QueryNotificationDto | null;
    paginationOptions: IPaginationOptions;
  }): Promise<Notification[]> {
    const where: FindOptionsWhere<NotificationEntity> = {
      userId: Number(userId),
      channels: inAppChannel(),
    };

    if (filterOptions?.category) {
      where.category = filterOptions.category;
    }

    if (filterOptions?.isRead !== undefined) {
      where.isRead = filterOptions.isRead;
    }

    const page = paginationOptions.page || 1;
    const limit = paginationOptions.limit || 10;
    const skip = (page - 1) * limit;

    const entities = await this.notificationRepository.find({
      skip,
      take: limit,
      where,
      order: { createdAt: 'DESC' },
    });

    return entities.map((entity) => NotificationMapper.toDomain(entity));
  }

  async findById(id: Notification['id']): Promise<NullableType<Notification>> {
    const entity = await this.notificationRepository.findOne({
      where: { id: Number(id) },
    });
    return entity ? NotificationMapper.toDomain(entity) : null;
  }

  async findByIdAndUserId(id: Notification['id'], userId: Notification['userId']): Promise<NullableType<Notification>> {
    const entity = await this.notificationRepository.findOne({
      where: { id: Number(id), userId: Number(userId), channels: inAppChannel() },
    });
    return entity ? NotificationMapper.toDomain(entity) : null;
  }

  async update(id: Notification['id'], payload: DeepPartial<Notification>): Promise<Notification | null> {
    const entity = await this.notificationRepository.findOne({
      where: { id: Number(id) },
    });

    if (!entity) {
      return null;
    }

    const clonedPayload = { ...payload };
    delete clonedPayload.id;
    delete clonedPayload.userId;

    Object.assign(entity, clonedPayload);

    const updatedEntity = await this.notificationRepository.save(entity);

    return NotificationMapper.toDomain(updatedEntity);
  }

  async markAsRead(id: Notification['id'], userId: Notification['userId']): Promise<Notification | null> {
    const entity = await this.notificationRepository.findOne({
      where: { id: Number(id), userId: Number(userId), channels: inAppChannel() },
    });

    if (!entity) {
      return null;
    }

    entity.isRead = true;
    entity.readAt = new Date();

    const updatedEntity = await this.notificationRepository.save(entity);

    return NotificationMapper.toDomain(updatedEntity);
  }

  async markAllAsRead(userId: Notification['userId']): Promise<void> {
    await this.notificationRepository.update(
      { userId: Number(userId), isRead: false, channels: inAppChannel() },
      { isRead: true, readAt: new Date() },
    );
  }

  async countUnreadByUserId(userId: Notification['userId']): Promise<number> {
    return this.notificationRepository.count({
      where: { userId: Number(userId), isRead: false, channels: inAppChannel() },
    });
  }

  async countUnreadByCategory(userId: Notification['userId']): Promise<Record<string, number>> {
    const results = await this.notificationRepository
      .createQueryBuilder('notification')
      .select('notification.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('notification.userId = :userId', { userId: Number(userId) })
      .andWhere('notification.isRead = :isRead', { isRead: false })
      .andWhere('notification.deletedAt IS NULL')
      .andWhere('notification.channels @> :inAppChannel', {
        inAppChannel: JSON.stringify([NotificationChannel.IN_APP]),
      })
      .groupBy('notification.category')
      .getRawMany();

    const counts: Record<string, number> = {};
    results.forEach((result) => {
      counts[result.category] = parseInt(result.count, 10);
    });

    return counts;
  }

  async countByUserId(userId: Notification['userId'], filterOptions?: QueryNotificationDto | null): Promise<number> {
    const where: FindOptionsWhere<NotificationEntity> = {
      userId: Number(userId),
      channels: inAppChannel(),
    };

    if (filterOptions?.category) {
      where.category = filterOptions.category;
    }

    if (filterOptions?.isRead !== undefined) {
      where.isRead = filterOptions.isRead;
    }

    return this.notificationRepository.count({ where });
  }

  async remove(id: Notification['id']): Promise<void> {
    await this.notificationRepository.softDelete(id);
  }
}
