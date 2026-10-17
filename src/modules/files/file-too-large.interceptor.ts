import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { fileTooLargeError } from './file-purposes';

/** 须放在 FileInterceptor 之前 */
@Injectable()
export class FileTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          throwError(() => (error instanceof PayloadTooLargeException ? fileTooLargeError() : error)),
        ),
      );
  }
}
