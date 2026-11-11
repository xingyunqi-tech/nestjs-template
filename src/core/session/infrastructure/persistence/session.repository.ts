import { User } from '../../../users/domain/user';
import { NullableType } from '../../../../common/types/nullable.type';
import { Session } from '../../domain/session';

export abstract class SessionRepository {
  abstract findById(id: Session['id']): Promise<NullableType<Session>>;

  abstract create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Session>;

  /** 仅当会话当前 hash 等于 currentHash 时替换为 nextHash，返回是否替换成功 */
  abstract rotateHash(id: Session['id'], currentHash: string, nextHash: string): Promise<boolean>;

  /** 未删除的会话，按最近活跃时间倒序 */
  abstract findActiveByUserId(userId: User['id']): Promise<Session[]>;

  /** 仅当 lastActiveAt 为空或早于 staleBefore 时更新为 at */
  abstract touch(id: Session['id'], at: Date, staleBefore: Date): Promise<void>;

  abstract deleteById(id: Session['id']): Promise<void>;

  /** 仅删除属于该用户且未删除的会话，返回是否删除 */
  abstract deleteByIdForUser(id: Session['id'], userId: User['id']): Promise<boolean>;

  /** 返回被删除的会话 ID */
  abstract deleteByUserId(conditions: { userId: User['id'] }): Promise<Session['id'][]>;

  /** 返回被删除的会话 ID */
  abstract deleteByUserIdWithExclude(conditions: {
    userId: User['id'];
    excludeSessionId: Session['id'];
  }): Promise<Session['id'][]>;
}
