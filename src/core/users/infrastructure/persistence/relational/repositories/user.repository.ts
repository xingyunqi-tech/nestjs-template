import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindOptionsWhere, Repository, In, IsNull, Not } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { UserEntity } from '../entities/user.entity';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { FilterUserDto, SortUserDto } from '../../../../dto/query-user.dto';
import { User } from '../../../../domain/user';
import { UserRepository } from '../../user.repository';
import { UserMapper } from '../mappers/user.mapper';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

function toPartialEntity(payload: Partial<User>): QueryDeepPartialEntity<UserEntity> {
  const { photo, role, status, ...columns } = payload;
  const changes: QueryDeepPartialEntity<UserEntity> = Object.fromEntries(
    UPDATABLE_COLUMNS.filter((key) => columns[key] !== undefined).map((key) => [key, columns[key]]),
  );
  if (photo !== undefined) {
    changes.photo = photo ? { id: photo.id } : null;
  }
  if (role) {
    changes.role = { id: Number(role.id) };
  }
  if (status) {
    changes.status = { id: Number(status.id) };
  }

  return changes;
}

const UPDATABLE_COLUMNS = [
  'email',
  'password',
  'provider',
  'firstName',
  'lastName',
  'phone',
  'nickname',
  'gender',
  'birthday',
  'wechatOpenId',
  'wechatUnionId',
  'alipayOpenId',
] as const;

@Injectable()
export class UsersRelationalRepository implements UserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async create(data: User): Promise<User> {
    const persistenceModel = UserMapper.toPersistence(data);
    const newEntity = await this.usersRepository.save(this.usersRepository.create(persistenceModel));
    return UserMapper.toDomain(newEntity);
  }

  async findManyWithPagination({
    filterOptions,
    sortOptions,
    paginationOptions,
  }: {
    filterOptions?: FilterUserDto | null;
    sortOptions?: SortUserDto[] | null;
    paginationOptions: IPaginationOptions;
  }): Promise<User[]> {
    const where: FindOptionsWhere<UserEntity> = {};
    if (filterOptions?.roles?.length) {
      where.role = filterOptions.roles.map((role) => ({
        id: Number(role.id),
      }));
    }

    const entities = await this.usersRepository.find({
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      where: where,
      order: sortOptions?.reduce(
        (accumulator, sort) => ({
          ...accumulator,
          [sort.orderBy]: sort.order,
        }),
        {},
      ),
      relations: { photo: true, role: true, status: true },
    });

    return entities.map((user) => UserMapper.toDomain(user));
  }

  async findById(id: User['id']): Promise<NullableType<User>> {
    const entity = await this.usersRepository.findOne({
      where: { id: Number(id) },
      relations: { photo: true, role: true, status: true },
    });

    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findDeletedById(id: User['id']): Promise<NullableType<User>> {
    const entity = await this.usersRepository.findOne({
      where: { id: Number(id), deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findByIds(ids: User['id'][]): Promise<User[]> {
    const entities = await this.usersRepository.find({
      where: { id: In(ids) },
      relations: { photo: true, role: true, status: true },
    });

    return entities.map((user) => UserMapper.toDomain(user));
  }

  async findByEmail(email: User['email']): Promise<NullableType<User>> {
    if (!email) return null;

    const entity = await this.usersRepository.findOne({
      where: { email },
      relations: { photo: true, role: true, status: true },
    });

    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findByPhone(phone: User['phone']): Promise<NullableType<User>> {
    if (!phone) return null;

    const entity = await this.usersRepository.findOne({
      where: { phone },
      relations: { photo: true, role: true, status: true },
    });

    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findByWechatOpenId(openId: string): Promise<NullableType<User>> {
    if (!openId) return null;

    const entity = await this.usersRepository.findOne({
      where: { wechatOpenId: openId },
      relations: { photo: true, role: true, status: true },
    });

    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findByAlipayOpenId(openId: string): Promise<NullableType<User>> {
    if (!openId) return null;

    const entity = await this.usersRepository.findOne({
      where: { alipayOpenId: openId },
      relations: { photo: true, role: true, status: true },
    });

    return entity ? UserMapper.toDomain(entity) : null;
  }

  /** 只更新 payload 中有值的字段，已软删除的用户视为不存在 */
  async update(id: User['id'], payload: Partial<User>): Promise<User> {
    const changes = toPartialEntity(payload);

    if (Object.keys(changes).length > 0) {
      const result = await this.usersRepository.update({ id: Number(id), deletedAt: IsNull() }, changes);
      if (!result.affected) {
        throw new NotFoundException('User not found');
      }
    }

    const entity = await this.usersRepository.findOne({
      where: { id: Number(id) },
      relations: { photo: true, role: true, status: true },
    });

    if (!entity) {
      throw new NotFoundException('User not found');
    }

    return UserMapper.toDomain(entity);
  }

  async bindPhoneIfEmpty(id: User['id'], phone: string): Promise<boolean> {
    const result = await this.usersRepository.update(
      { id: Number(id), phone: IsNull(), deletedAt: IsNull() },
      { phone },
    );
    return Boolean(result.affected);
  }

  async bindWechatIfEmpty(id: User['id'], openId: string, unionId?: string | null): Promise<boolean> {
    const result = await this.usersRepository.update(
      { id: Number(id), wechatOpenId: IsNull(), deletedAt: IsNull() },
      { wechatOpenId: openId, ...(unionId && { wechatUnionId: unionId }) },
    );
    return Boolean(result.affected);
  }

  /**
   * 软删除用户，同时清空邮箱、手机号与微信标识，使其可被重新注册
   */
  async remove(id: User['id']): Promise<void> {
    await this.usersRepository.manager.transaction(async (manager) => {
      await manager.update(UserEntity, id, {
        email: null,
        phone: null,
        wechatOpenId: null,
        wechatUnionId: null,
        alipayOpenId: null,
      });
      await manager.softDelete(UserEntity, id);
    });
  }

  async detachPhoto(id: User['id']): Promise<void> {
    await this.usersRepository.update({ id: Number(id) }, { photo: null });
  }
}
