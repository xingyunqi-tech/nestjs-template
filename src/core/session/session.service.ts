import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { SessionRepository } from './infrastructure/persistence/session.repository';
import { Session } from './domain/session';
import { User } from '../users/domain/user';
import { NullableType } from '../../common/types/nullable.type';

/** 刷新令牌轮换后，旧 hash 视为并发或重试请求而非盗用的时长 */
const ROTATED_HASH_GRACE_MS = 60_000;

/** 同一会话两次写入 lastActiveAt 的最小间隔 */
const LAST_ACTIVE_MIN_INTERVAL_MS = 5 * 60_000;

/** JwtStrategy 缓存会话校验结果使用的键 */
export function sessionAuthCacheKey(id: Session['id']): string {
  return `jwt:session:${id}`;
}

function rotatedHashCacheKey(id: Session['id']): string {
  return `session:rotated:${id}`;
}

/**
 * 会话服务 - 管理用户登录会话
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly sessionRepository: SessionRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * 根据ID查找会话
   * @param id - 会话ID
   * @returns 会话对象或 null
   */
  findById(id: Session['id']): Promise<NullableType<Session>> {
    return this.sessionRepository.findById(id);
  }

  /**
   * 创建新会话
   * @param data - 会话数据（不包含ID和时间戳）
   * @returns 创建成功的会话对象
   */
  async create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Session> {
    const session = await this.sessionRepository.create(data);
    this.logger.debug(`Session created: ${session.id} for user: ${data.user.id}`);
    return session;
  }

  findActiveByUserId(userId: User['id']): Promise<Session[]> {
    return this.sessionRepository.findActiveByUserId(userId);
  }

  /** 记录会话活跃时间；写入失败只记日志，不影响请求 */
  async touch(id: Session['id']): Promise<void> {
    const now = new Date();
    try {
      await this.sessionRepository.touch(id, now, new Date(now.getTime() - LAST_ACTIVE_MIN_INTERVAL_MS));
    } catch (error) {
      this.logger.warn(`Failed to update lastActiveAt of session ${id}: ${String(error)}`);
    }
  }

  /** 删除属于该用户的会话并清除令牌校验缓存，返回是否删除 */
  async revokeForUser(id: Session['id'], userId: User['id']): Promise<boolean> {
    const deleted = await this.sessionRepository.deleteByIdForUser(id, userId);
    if (deleted) {
      await this.forgetSessions([id]);
    }
    return deleted;
  }

  /** 仅当当前 hash 等于 currentHash 时轮换，成功后在宽限期内记住旧 hash */
  async rotateHash(id: Session['id'], currentHash: string, nextHash: string): Promise<boolean> {
    const rotated = await this.sessionRepository.rotateHash(id, currentHash, nextHash);
    if (rotated) {
      await this.cacheManager.set(rotatedHashCacheKey(id), currentHash, ROTATED_HASH_GRACE_MS);
    }
    return rotated;
  }

  async wasRecentlyRotatedFrom(id: Session['id'], hash: string): Promise<boolean> {
    return (await this.cacheManager.get<string>(rotatedHashCacheKey(id))) === hash;
  }

  /** 清除会话的令牌校验缓存，用于会话已在别处删除的情况 */
  async forgetSessions(ids: Session['id'][]): Promise<void> {
    await Promise.all(ids.map((id) => this.cacheManager.del(sessionAuthCacheKey(id))));
  }

  /** 删除会话并清除令牌校验缓存，使该会话的访问令牌立即失效 */
  async revoke(id: Session['id']): Promise<void> {
    await this.deleteById(id);
    this.logger.debug(`Session revoked: ${id}`);
  }

  /**
   * 根据ID删除会话并清除令牌校验缓存
   * @param id - 会话ID
   */
  async deleteById(id: Session['id']): Promise<void> {
    await this.sessionRepository.deleteById(id);
    await this.forgetSessions([id]);
    this.logger.debug(`Session deleted: ${id}`);
  }

  /**
   * 删除用户的所有会话并清除令牌校验缓存
   * @param conditions - 包含用户ID的条件对象
   */
  async deleteByUserId(conditions: { userId: User['id'] }): Promise<void> {
    const ids = await this.sessionRepository.deleteByUserId(conditions);
    await this.forgetSessions(ids);
    this.logger.debug(`All sessions deleted for user: ${conditions.userId}`);
  }

  /**
   * 删除用户的所有会话（排除指定会话）并清除令牌校验缓存
   * @param conditions - 包含用户ID和排除会话ID的条件对象
   */
  async deleteByUserIdWithExclude(conditions: { userId: User['id']; excludeSessionId: Session['id'] }): Promise<void> {
    const ids = await this.sessionRepository.deleteByUserIdWithExclude(conditions);
    await this.forgetSessions(ids);
    this.logger.debug(`Sessions deleted for user: ${conditions.userId}, excluding: ${conditions.excludeSessionId}`);
  }
}
