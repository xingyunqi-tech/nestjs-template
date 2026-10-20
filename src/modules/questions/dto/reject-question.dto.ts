import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Length } from 'class-validator';
import { REJECT_REASON_MAX_LENGTH } from '../domain/question';

export class RejectQuestionDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: REJECT_REASON_MAX_LENGTH,
    description: '驳回原因，去除首尾空白后计算长度',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, REJECT_REASON_MAX_LENGTH, { message: 'rejectReasonLength' })
  reason: string;
}
