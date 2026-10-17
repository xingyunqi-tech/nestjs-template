import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** 未携带或携带无效 token 时 `request.user` 为 undefined，不拒绝请求 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser>(err: unknown, user: TUser | false | null): TUser | undefined {
    if (err instanceof Error && !(err instanceof HttpException && err.getStatus() === HttpStatus.UNAUTHORIZED)) {
      throw err;
    }
    if (!user) {
      return undefined;
    }
    return user;
  }
}
