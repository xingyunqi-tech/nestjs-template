import { BadRequestException, CallHandler, ExecutionContext, PayloadTooLargeException } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';
import { FileTooLargeInterceptor } from './file-too-large.interceptor';

const run = (error: Error): Promise<unknown> =>
  firstValueFrom(
    new FileTooLargeInterceptor().intercept({} as ExecutionContext, {
      handle: () => throwError(() => error),
    } as CallHandler),
  );

describe('FileTooLargeInterceptor', () => {
  it('should map the upload middleware size error to fileTooLarge', async () => {
    await expect(run(new PayloadTooLargeException('File too large'))).rejects.toMatchObject({
      status: 413,
      response: { errors: { file: 'fileTooLarge' } },
    });
  });

  it('should keep other errors', async () => {
    const error = new BadRequestException();
    await expect(run(error)).rejects.toBe(error);
  });
});
