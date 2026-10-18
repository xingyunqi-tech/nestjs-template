import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AddressEntity } from '../entities/address.entity';
import { AddressRepository } from '../../address.repository';
import { AddressMapper } from '../mappers/address.mapper';
import { Address } from '../../../../domain/address';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { FilterAddressDto, SortAddressDto } from '../../../../dto/query-address.dto';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { buildFindOptions } from '../../../../../../infrastructure/database/utils/repository.utils';

/** update 允许写入的列，只写入 payload 中出现的字段 */
const UPDATABLE_COLUMNS = [
  'name',
  'phone',
  'provinceCode',
  'cityCode',
  'districtCode',
  'province',
  'city',
  'district',
  'address',
  'isDefault',
] as const;

@Injectable()
export class AddressRelationalRepository implements AddressRepository {
  constructor(
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
  ) {}

  async create(data: Omit<Address, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Address> {
    const persistenceModel = AddressMapper.toPersistence(data);
    const newEntity = await this.addressRepository.save(this.addressRepository.create(persistenceModel));
    return AddressMapper.toDomain(newEntity);
  }

  async createWithinLimit(
    data: Omit<Address, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    limit: number,
  ): Promise<{ address: Address; previousCount: number } | null> {
    return this.addressRepository.manager.transaction(async (manager) => {
      await this.lockUserAddresses(manager, data.userId);
      const previousCount = await manager.count(AddressEntity, { where: { userId: Number(data.userId) } });
      if (previousCount >= limit) {
        return null;
      }
      const entity = await manager.save(manager.create(AddressEntity, AddressMapper.toPersistence(data)));
      return { address: AddressMapper.toDomain(entity), previousCount };
    });
  }

  async findManyWithPagination({
    userId,
    filterOptions,
    sortOptions,
    paginationOptions,
  }: {
    userId: Address['userId'];
    filterOptions?: FilterAddressDto | null;
    sortOptions?: SortAddressDto[] | null;
    paginationOptions: IPaginationOptions;
  }): Promise<Address[]> {
    const where = this.buildWhere(userId, filterOptions);

    const { skip, take, order } = buildFindOptions({
      paginationOptions,
      sortOptions,
      defaultOrder: { isDefault: 'DESC', createdAt: 'DESC' },
    });

    const entities = await this.addressRepository.find({
      skip,
      take,
      where,
      order,
    });

    return entities.map((entity) => AddressMapper.toDomain(entity));
  }

  async findById(id: Address['id']): Promise<NullableType<Address>> {
    const entity = await this.addressRepository.findOne({
      where: { id: Number(id) },
    });
    return entity ? AddressMapper.toDomain(entity) : null;
  }

  async findByIdAndUserId(id: Address['id'], userId: Address['userId']): Promise<NullableType<Address>> {
    const entity = await this.addressRepository.findOne({
      where: { id: Number(id), userId: Number(userId) },
    });
    return entity ? AddressMapper.toDomain(entity) : null;
  }

  async findDefaultByUserId(userId: Address['userId']): Promise<NullableType<Address>> {
    const entity = await this.addressRepository.findOne({
      where: { userId: Number(userId), isDefault: true },
    });
    return entity ? AddressMapper.toDomain(entity) : null;
  }

  async update(id: Address['id'], payload: Partial<Address>): Promise<Address | null> {
    const changes: QueryDeepPartialEntity<AddressEntity> = Object.fromEntries(
      UPDATABLE_COLUMNS.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]),
    );

    if (Object.keys(changes).length > 0) {
      await this.addressRepository.update({ id: Number(id), deletedAt: IsNull() }, changes);
    }

    const entity = await this.addressRepository.findOne({ where: { id: Number(id) } });
    return entity ? AddressMapper.toDomain(entity) : null;
  }

  async markDefault(id: Address['id'], userId: Address['userId']): Promise<void> {
    // 先清除再设置，满足"每个用户最多一个默认地址"的唯一索引
    await this.addressRepository.manager.transaction(async (manager) => {
      await this.lockUserAddresses(manager, userId);
      const target: unknown[] = await manager.query(
        `SELECT 1 FROM "address" WHERE "id" = $1 AND "userId" = $2 AND "deletedAt" IS NULL`,
        [Number(id), Number(userId)],
      );
      if (target.length === 0) {
        return;
      }
      await manager.query(
        `UPDATE "address" SET "isDefault" = false WHERE "userId" = $1 AND "isDefault" AND "id" <> $2 AND "deletedAt" IS NULL`,
        [Number(userId), Number(id)],
      );
      await manager.query(
        `UPDATE "address" SET "isDefault" = true WHERE "id" = $1 AND "userId" = $2 AND "deletedAt" IS NULL`,
        [Number(id), Number(userId)],
      );
    });
  }

  async remove(id: Address['id']): Promise<void> {
    await this.addressRepository.softDelete(id);
  }

  async countByUserId(userId: Address['userId'], filterOptions?: FilterAddressDto | null): Promise<number> {
    return this.addressRepository.count({
      where: this.buildWhere(userId, filterOptions),
    });
  }

  /** 事务内串行化同一用户的地址创建与默认地址设置 */
  private async lockUserAddresses(manager: EntityManager, userId: Address['userId']): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('address'), $1)`, [Number(userId)]);
  }

  private buildWhere(
    userId: Address['userId'],
    filterOptions?: FilterAddressDto | null,
  ): FindOptionsWhere<AddressEntity> {
    const where: FindOptionsWhere<AddressEntity> = {
      userId: Number(userId),
    };

    if (filterOptions?.province) {
      where.province = filterOptions.province;
    }
    if (filterOptions?.city) {
      where.city = filterOptions.city;
    }
    if (filterOptions?.provinceCode) {
      where.provinceCode = filterOptions.provinceCode;
    }
    if (filterOptions?.cityCode) {
      where.cityCode = filterOptions.cityCode;
    }
    if (filterOptions?.districtCode) {
      where.districtCode = filterOptions.districtCode;
    }

    return where;
  }

  async removeByUser(userId: number): Promise<void> {
    await this.addressRepository.delete({ userId });
  }
}
