import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AdminAlertEntity } from '../entities/admin-alert.entity';
import { AdminAlertMapper } from '../mappers/admin-alert.mapper';
import { AdminAlertRepository, CreateAdminAlertData } from '../../admin-alert.repository';
import { AdminAlert } from '../../../../domain/admin-alert';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { QueryAdminAlertDto } from '../../../../dto/query-admin-alert.dto';

@Injectable()
export class AdminAlertRelationalRepository implements AdminAlertRepository {
  constructor(
    @InjectRepository(AdminAlertEntity)
    private readonly alertRepository: Repository<AdminAlertEntity>,
  ) {}

  async createIfNoOpen(data: CreateAdminAlertData): Promise<NullableType<AdminAlert>> {
    const result = await this.alertRepository
      .createQueryBuilder()
      .insert()
      .into(AdminAlertEntity)
      .values(AdminAlertMapper.toPersistence(data) as QueryDeepPartialEntity<AdminAlertEntity>)
      .orIgnore()
      .returning('*')
      .execute();

    const row = (result.raw as AdminAlertEntity[])[0];
    return row ? AdminAlertMapper.toDomain(this.alertRepository.create(row)) : null;
  }

  async findById(id: AdminAlert['id']): Promise<NullableType<AdminAlert>> {
    const entity = await this.alertRepository.findOne({ where: { id } });
    return entity ? AdminAlertMapper.toDomain(entity) : null;
  }

  async findManyWithPaginationAndCount({
    filterOptions,
    paginationOptions,
  }: {
    filterOptions?: Pick<QueryAdminAlertDto, 'acknowledged' | 'level' | 'type'> | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: AdminAlert[]; total: number }> {
    const where: FindOptionsWhere<AdminAlertEntity> = {};
    if (filterOptions?.acknowledged !== undefined) {
      where.acknowledgedAt = filterOptions.acknowledged ? Not(IsNull()) : IsNull();
    }
    if (filterOptions?.level) {
      where.level = filterOptions.level;
    }
    if (filterOptions?.type) {
      where.type = filterOptions.type;
    }

    const [entities, total] = await this.alertRepository.findAndCount({
      where,
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return { data: entities.map((entity) => AdminAlertMapper.toDomain(entity)), total };
  }

  async acknowledge(id: AdminAlert['id']): Promise<NullableType<AdminAlert>> {
    await this.alertRepository.update({ id, acknowledgedAt: IsNull() }, { acknowledgedAt: () => 'CURRENT_TIMESTAMP' });
    return this.findById(id);
  }
}
