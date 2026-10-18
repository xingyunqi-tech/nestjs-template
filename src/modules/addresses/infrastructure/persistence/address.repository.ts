import { NullableType } from '../../../../common/types/nullable.type';
import { Address } from '../../domain/address';
import { DeepPartial } from '../../../../common/types/deep-partial.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { FilterAddressDto, SortAddressDto } from '../../dto/query-address.dto';

export abstract class AddressRepository {
  abstract create(data: Omit<Address, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Address>;

  /** 用户现有地址数小于 limit 时创建，返回新地址与创建前的数量；达到上限时返回 null */
  abstract createWithinLimit(
    data: Omit<Address, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    limit: number,
  ): Promise<{ address: Address; previousCount: number } | null>;

  abstract findManyWithPagination({
    userId,
    filterOptions,
    sortOptions,
    paginationOptions,
  }: {
    userId: Address['userId'];
    filterOptions?: FilterAddressDto | null;
    sortOptions?: SortAddressDto[] | null;
    paginationOptions: IPaginationOptions;
  }): Promise<Address[]>;

  abstract findById(id: Address['id']): Promise<NullableType<Address>>;

  abstract findByIdAndUserId(id: Address['id'], userId: Address['userId']): Promise<NullableType<Address>>;

  abstract findDefaultByUserId(userId: Address['userId']): Promise<NullableType<Address>>;

  abstract update(id: Address['id'], payload: DeepPartial<Address>): Promise<Address | null>;

  /** 将指定地址设为该用户唯一的默认地址 */
  abstract markDefault(id: Address['id'], userId: Address['userId']): Promise<void>;

  abstract remove(id: Address['id']): Promise<void>;

  abstract countByUserId(userId: Address['userId'], filterOptions?: FilterAddressDto | null): Promise<number>;

  /** 物理删除该用户的全部地址（含已软删除的） */
  abstract removeByUser(userId: number): Promise<void>;
}
