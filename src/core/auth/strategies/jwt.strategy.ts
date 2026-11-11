import { ExtractJwt, Strategy } from 'passport-jwt';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { OrNeverType } from '../../../common/types/or-never.type';
import { JwtPayloadType } from './types/jwt-payload.type';
import { AllConfigType } from '../../../config/config.type';
import { UsersService } from '../../users/users.service';
import { SessionService, sessionAuthCacheKey } from '../../session/session.service';
import { isUserStatusAllowedForAuth } from '../../../common/utils/status.util';

/** JWT 会话与用户校验缓存 TTL：30 秒（平衡安全性与性能） */
const JWT_USER_CACHE_TTL_MS = 30_000;

/** 以库中当前角色覆盖令牌签发时的角色；roleId 为 undefined 表示缓存中没有角色信息 */
function withRole(payload: JwtPayloadType, roleId: number | null | undefined): JwtPayloadType {
  if (roleId === undefined) {
    return payload;
  }
  return { ...payload, role: roleId === null ? null : { ...payload.role, id: roleId } };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AllConfigType>,
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow('auth.secret', { infer: true }),
    });
  }

  public async validate(payload: JwtPayloadType): Promise<OrNeverType<JwtPayloadType>> {
    if (!payload.id || !payload.sessionId) {
      throw new UnauthorizedException();
    }

    // 先查缓存，避免每次请求都查库；用户状态和角色变更最多 30 秒后生效
    const cacheKey = sessionAuthCacheKey(payload.sessionId);
    const cached = await this.cacheManager.get<{ statusId?: number; roleId?: number | null }>(cacheKey);

    if (cached) {
      if (!isUserStatusAllowedForAuth(cached.statusId)) {
        throw new UnauthorizedException('User is not active');
      }
      return withRole(payload, cached.roleId);
    }

    // 缓存未命中，查库：会话需存在且属于该用户
    const session = await this.sessionService.findById(payload.sessionId);
    if (!session || String(session.user?.id) !== String(payload.id)) {
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.usersService.findById(payload.id);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!isUserStatusAllowedForAuth(user.status?.id)) {
      throw new UnauthorizedException('User is not active');
    }

    await this.sessionService.touch(session.id);

    // 写入缓存
    await this.cacheManager.set(
      cacheKey,
      { statusId: user.status?.id, roleId: user.role?.id ?? null },
      JWT_USER_CACHE_TTL_MS,
    );

    return withRole(payload, user.role?.id ?? null);
  }
}
