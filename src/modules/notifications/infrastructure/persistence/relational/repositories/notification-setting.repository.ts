import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationSettingEntity } from '../entities/notification-setting.entity';
import { NotificationSettingRepository } from '../../notification-setting.repository';
import { NotificationSettingMapper } from '../mappers/notification-setting.mapper';
import { NotificationSetting } from '../../../../domain/notification-setting';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { NotificationCategory } from '../../../../domain/notification';

@Injectable()
export class NotificationSettingRelationalRepository implements NotificationSettingRepository {
  constructor(
    @InjectRepository(NotificationSettingEntity)
    private readonly settingRepository: Repository<NotificationSettingEntity>,
  ) {}

  async create(data: Omit<NotificationSetting, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationSetting> {
    const persistenceModel = NotificationSettingMapper.toPersistence(data);
    const newEntity = await this.settingRepository.save(this.settingRepository.create(persistenceModel));
    return NotificationSettingMapper.toDomain(newEntity);
  }

  async findByUserIdAndCategory(
    userId: NotificationSetting['userId'],
    category: NotificationCategory,
  ): Promise<NullableType<NotificationSetting>> {
    const entity = await this.settingRepository.findOne({
      where: { userId: Number(userId), category },
    });
    return entity ? NotificationSettingMapper.toDomain(entity) : null;
  }

  async findAllByUserId(userId: NotificationSetting['userId']): Promise<NotificationSetting[]> {
    const entities = await this.settingRepository.find({
      where: { userId: Number(userId) },
    });
    return entities.map((entity) => NotificationSettingMapper.toDomain(entity));
  }

  async update(
    userId: NotificationSetting['userId'],
    category: NotificationCategory,
    payload: Partial<NotificationSetting>,
  ): Promise<NotificationSetting | null> {
    const entity = await this.settingRepository.findOne({
      where: { userId: Number(userId), category },
    });

    if (!entity) {
      return null;
    }

    const clonedPayload = { ...payload };
    delete clonedPayload.id;
    delete clonedPayload.userId;
    delete clonedPayload.category;

    Object.assign(entity, clonedPayload);

    const updatedEntity = await this.settingRepository.save(entity);

    return NotificationSettingMapper.toDomain(updatedEntity);
  }

  async initializeDefaultSettings(userId: NotificationSetting['userId']): Promise<void> {
    const categories = Object.values(NotificationCategory);

    for (const category of categories) {
      const existing = await this.settingRepository.findOne({
        where: { userId: Number(userId), category },
      });

      if (!existing) {
        await this.settingRepository.save(
          this.settingRepository.create({
            userId: Number(userId),
            category,
            enableInApp: true,
            enableEmail: true,
            enableSms: true,
            enablePush: true,
          }),
        );
      }
    }
  }

  async removeByUser(userId: number): Promise<void> {
    await this.settingRepository.delete({ userId });
  }
}
