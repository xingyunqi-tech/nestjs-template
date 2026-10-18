import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ShareEntity } from '../entities/share.entity';
import { ShareRepository } from '../../share.repository';
import { ShareMapper } from '../mappers/share.mapper';
import { Share } from '../../../../domain/share';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { QueryShareDto } from '../../../../dto/query-share.dto';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { DeepPartial } from '../../../../../../common/types/deep-partial.type';

@Injectable()
export class ShareRelationalRepository implements ShareRepository {
  constructor(
    @InjectRepository(ShareEntity)
    private readonly shareRepository: Repository<ShareEntity>,
  ) {}

  async create(data: Omit<Share, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Share> {
    const persistenceModel = ShareMapper.toPersistence(data);
    const newEntity = await this.shareRepository.save(this.shareRepository.create(persistenceModel));
    return ShareMapper.toDomain(newEntity);
  }

  async findManyWithPagination({
    userId,
    filterOptions,
    paginationOptions,
  }: {
    userId: Share['userId'];
    filterOptions?: QueryShareDto | null;
    paginationOptions: IPaginationOptions;
  }): Promise<Share[]> {
    const where: FindOptionsWhere<ShareEntity> = {
      userId: Number(userId),
    };

    if (filterOptions?.targetType) {
      where.targetType = filterOptions.targetType;
    }

    if (filterOptions?.platform) {
      where.platform = filterOptions.platform;
    }

    if (filterOptions?.targetId) {
      where.targetId = filterOptions.targetId;
    }

    const page = paginationOptions.page || 1;
    const limit = paginationOptions.limit || 10;
    const skip = (page - 1) * limit;

    const entities = await this.shareRepository.find({
      skip,
      take: limit,
      where,
      order: { createdAt: 'DESC' },
    });

    return entities.map((entity) => ShareMapper.toDomain(entity));
  }

  async findById(id: Share['id']): Promise<NullableType<Share>> {
    const entity = await this.shareRepository.findOne({
      where: { id: Number(id) },
    });
    return entity ? ShareMapper.toDomain(entity) : null;
  }

  async findByIdAndUserId(id: Share['id'], userId: Share['userId']): Promise<NullableType<Share>> {
    const entity = await this.shareRepository.findOne({
      where: { id: Number(id), userId: Number(userId) },
    });
    return entity ? ShareMapper.toDomain(entity) : null;
  }

  async findByShareCode(shareCode: string): Promise<NullableType<Share>> {
    const entity = await this.shareRepository.findOne({
      where: { shareCode },
    });
    return entity ? ShareMapper.toDomain(entity) : null;
  }

  async update(id: Share['id'], payload: DeepPartial<Share>): Promise<Share | null> {
    const entity = await this.shareRepository.findOne({
      where: { id: Number(id) },
    });

    if (!entity) {
      return null;
    }

    const clonedPayload = { ...payload };
    delete clonedPayload.id;
    delete clonedPayload.userId;
    delete clonedPayload.shareCode;

    Object.assign(entity, clonedPayload);

    const updatedEntity = await this.shareRepository.save(entity);

    return ShareMapper.toDomain(updatedEntity);
  }

  async incrementViewCount(id: Share['id']): Promise<void> {
    await this.shareRepository.increment({ id: Number(id) }, 'viewCount', 1);
  }

  async incrementClickCount(id: Share['id']): Promise<void> {
    await this.shareRepository.increment({ id: Number(id) }, 'clickCount', 1);
  }

  async incrementConversionCount(id: Share['id']): Promise<void> {
    await this.shareRepository.increment({ id: Number(id) }, 'conversionCount', 1);
  }

  async countByUserId(userId: Share['userId'], filterOptions?: QueryShareDto | null): Promise<number> {
    const where: FindOptionsWhere<ShareEntity> = {
      userId: Number(userId),
    };

    if (filterOptions?.targetType) {
      where.targetType = filterOptions.targetType;
    }

    if (filterOptions?.platform) {
      where.platform = filterOptions.platform;
    }

    if (filterOptions?.targetId) {
      where.targetId = filterOptions.targetId;
    }

    return this.shareRepository.count({ where });
  }

  async remove(id: Share['id']): Promise<void> {
    await this.shareRepository.softDelete(id);
  }

  async removeByUser(userId: number): Promise<void> {
    await this.shareRepository.delete({ userId });
  }
}
