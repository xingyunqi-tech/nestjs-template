import { BadRequestException, HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUUID(value)) {
      throw new BadRequestException({
        status: HttpStatus.BAD_REQUEST,
        errors: {
          id: 'invalidId',
        },
      });
    }
    return value.toLowerCase();
  }
}
