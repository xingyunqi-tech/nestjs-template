import { ExecutionContext, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import passport from 'passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const SECRET = 'optional-guard-secret';
const jwt = new JwtService({ secret: SECRET });
let verify: (payload: { id: number }) => unknown;

function context(authorization?: string): { ctx: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  beforeAll(() => {
    passport.use(
      'jwt',
      new Strategy(
        { jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET },
        (payload, done) => {
          try {
            done(null, verify(payload as { id: number }));
          } catch (error) {
            done(error);
          }
        },
      ),
    );
  });

  beforeEach(() => {
    verify = (payload) => ({ id: payload.id });
  });

  it('should set the user when the token is valid', async () => {
    const { ctx, request } = context(`Bearer ${jwt.sign({ id: 7 })}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 7 });
  });

  it('should treat a request without token as a guest', async () => {
    const { ctx, request } = context();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('should treat an expired token as a guest', async () => {
    const { ctx, request } = context(`Bearer ${jwt.sign({ id: 7 }, { expiresIn: -10 })}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('should treat a token signed with another secret as a guest', async () => {
    const { ctx, request } = context(`Bearer ${new JwtService({ secret: 'other' }).sign({ id: 7 })}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('should treat a revoked session as a guest', async () => {
    verify = () => {
      throw new UnauthorizedException('Session expired');
    };
    const { ctx, request } = context(`Bearer ${jwt.sign({ id: 7 })}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('should propagate errors other than 401', async () => {
    verify = () => {
      throw new InternalServerErrorException();
    };
    const { ctx } = context(`Bearer ${jwt.sign({ id: 7 })}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
