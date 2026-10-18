import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { QuestionReportReason } from '../domain/feedback';

const trimToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateQuestionReportDto {
  @ApiProperty({ enum: QuestionReportReason, enumName: 'QuestionReportReason' })
  @IsEnum(QuestionReportReason)
  reason: QuestionReportReason;

  @ApiPropertyOptional({ type: String, maxLength: 1000, description: '说明，原因为「其他」时必填' })
  @Transform(trimToUndefined)
  @ValidateIf((dto: CreateQuestionReportDto) => dto.reason === QuestionReportReason.OTHER || dto.content !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content?: string;

  @ApiPropertyOptional({ type: [String], description: '截图地址（最多 5 张）' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @ArrayMaxSize(5)
  images?: string[];

  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact?: string;
}
