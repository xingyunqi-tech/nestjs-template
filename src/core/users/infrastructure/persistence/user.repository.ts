import { DeepPartial } from '../../../../common/types/deep-partial.type';
import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { User } from '../../domain/user';

import { FilterUserDto, SortUserDto } from '../../dto/query-user.dto';

export abstract class UserRepository {
  abstract create(data: Omit<User, 'id' | 'createdAt' | 'deletedAt' | 'updatedAt'>): Promise<User>;

  abstract findManyWithPagination({
    filterOptions,
    sortOptions,
    paginationOptions,
  }: {
    filterOptions?: FilterUserDto | null;
    sortOptions?: SortUserDto[] | null;
    paginationOptions: IPaginationOptions;
  }): Promise<User[]>;

  abstract findById(id: User['id']): Promise<NullableType<User>>;

  /** 已软删除的用户，未删除或不存在时为 null */
  abstract findDeletedById(id: User['id']): Promise<NullableType<User>>;
  abstract findByIds(ids: User['id'][]): Promise<User[]>;
  abstract findByEmail(email: User['email']): Promise<NullableType<User>>;
  abstract findByPhone(phone: User['phone']): Promise<NullableType<User>>;
  abstract findByWechatOpenId(openId: string): Promise<NullableType<User>>;
  abstract findByAlipayOpenId(openId: string): Promise<NullableType<User>>;

  abstract update(id: User['id'], payload: DeepPartial<User>): Promise<User | null>;

  /** 用户未绑定手机号时绑定，返回是否绑定成功 */
  abstract bindPhoneIfEmpty(id: User['id'], phone: string): Promise<boolean>;

  /** 用户未绑定微信时绑定 openId（及 unionId），返回是否绑定成功 */
  abstract bindWechatIfEmpty(id: User['id'], openId: string, unionId?: string | null): Promise<boolean>;

  abstract remove(id: User['id']): Promise<void>;

  /** 解除头像文件引用，含已软删除的用户 */
  abstract detachPhoto(id: User['id']): Promise<void>;
}
