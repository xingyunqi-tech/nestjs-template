import { ExecutionContext, Injectable } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  normalizeIp,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AllConfigType } from '../../config/config.type';

interface TrackedRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** 限流计数主体：声明了 `AuthGuard('jwt')` 的路由按 `user:{id}`，其余路由按 `ip:{ip}` */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  private readonly jwtService = new JwtService();
  private readonly jwtGuard = AuthGuard('jwt');

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>, context?: ExecutionContext): Promise<string> {
    const request = req as TrackedRequest;
    if (context && this.requiresAuthentication(context)) {
      const userId = await this.userIdFromToken(request);
      if (userId !== undefined && userId !== null) {
        return `user:${userId}`;
      }
    }
    return `ip:${normalizeIp(request.ip ?? '', this.ipv6SubnetPrefix)}`;
  }

  private requiresAuthentication(context: ExecutionContext): boolean {
    const guards = [
      ...(this.reflector.get<unknown[] | undefined>(GUARDS_METADATA, context.getHandler()) ?? []),
      ...(this.reflector.get<unknown[] | undefined>(GUARDS_METADATA, context.getClass()) ?? []),
    ];
    return guards.includes(this.jwtGuard);
  }

  private async userIdFromToken(request: TrackedRequest): Promise<number | string | undefined> {
    const authorization = request.headers?.authorization;
    const [scheme, token] = (typeof authorization === 'string' ? authorization : '').trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return undefined;
    }
    try {
      const payload = await this.jwtService.verifyAsync<{ id?: number | string }>(token, {
        secret: this.configService.getOrThrow('auth.secret', { infer: true }),
      });
      return payload.id;
    } catch {
      return undefined;
    }
  }
}
