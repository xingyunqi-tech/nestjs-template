import { Controller, ExecutionContext, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { UserThrottlerGuard } from './user-throttler.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';

const SECRET = 'throttler-secret';

@Controller()
class ProbeController {
  @Get()
  @UseGuards(AuthGuard('jwt'))
  authenticated(): void {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  optional(): void {}

  @Get()
  open(): void {}
}

@Controller()
@UseGuards(AuthGuard('jwt'))
class AuthenticatedController {
  @Get()
  list(): void {}
}

function context(target: new () => object, handler: string): ExecutionContext {
  return {
    getClass: () => target,
    getHandler: () => (target.prototype as Record<string, unknown>)[handler],
  } as unknown as ExecutionContext;
}

describe('UserThrottlerGuard', () => {
  const guard = new UserThrottlerGuard({ throttlers: [] }, {} as ThrottlerStorage, new Reflector(), {
    getOrThrow: () => SECRET,
  } as unknown as ConfigService);
  const tracker = (req: Record<string, unknown>, ctx: ExecutionContext): Promise<string> =>
    (
      guard as unknown as { getTracker(req: Record<string, unknown>, ctx: ExecutionContext): Promise<string> }
    ).getTracker(req, ctx);
  const bearer = (secret = SECRET): Record<string, string> => ({
    authorization: `Bearer ${new JwtService({ secret }).sign({ id: 9 })}`,
  });

  it('should track authenticated routes by user id regardless of IP', async () => {
    const ctx = context(ProbeController, 'authenticated');
    await expect(tracker({ ip: '1.1.1.1', headers: bearer() }, ctx)).resolves.toBe('user:9');
    await expect(tracker({ ip: '2.2.2.2', headers: bearer() }, ctx)).resolves.toBe('user:9');
  });

  it('should honor a class level authentication guard', async () => {
    await expect(tracker({ ip: '1.1.1.1', headers: bearer() }, context(AuthenticatedController, 'list'))).resolves.toBe(
      'user:9',
    );
  });

  it('should track optionally authenticated and open routes by IP even with a valid token', async () => {
    await expect(tracker({ ip: '1.1.1.1', headers: bearer() }, context(ProbeController, 'optional'))).resolves.toBe(
      'ip:1.1.1.1',
    );
    await expect(tracker({ ip: '1.1.1.1', headers: bearer() }, context(ProbeController, 'open'))).resolves.toBe(
      'ip:1.1.1.1',
    );
  });

  it('should track an authenticated route by IP when the token is invalid or missing', async () => {
    const ctx = context(ProbeController, 'authenticated');
    await expect(tracker({ ip: '1.1.1.1', headers: bearer('other') }, ctx)).resolves.toBe('ip:1.1.1.1');
    await expect(tracker({ ip: '1.1.1.1', headers: {} }, ctx)).resolves.toBe('ip:1.1.1.1');
  });
});
