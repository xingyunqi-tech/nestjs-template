import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { WrongQuestionStatus } from '../domain/wrong-question';
import { WrongBookSortField } from '../infrastructure/persistence/wrong-question.repository';

const lowercase = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.toLowerCase() : value);
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const toInt = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === '' ? undefined : Number(value);

export class QueryWrongBookDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '含子树' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  knowledgePointId?: string;

  @ApiPropertyOptional({
    enum: WrongQuestionStatus,
    enumName: 'WrongQuestionStatus',
    default: WrongQuestionStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(WrongQuestionStatus)
  status?: WrongQuestionStatus;

  @ApiPropertyOptional({ type: Number, minimum: 1, description: '错误次数下限（含）' })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  minWrongCount?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, description: '错误次数上限（含）' })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  maxWrongCount?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-10-12T00:00:00+08:00',
    description: '最近错误时间起（含），带时区的 ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME, { message: 'zonedDateTimeRequired' })
  lastWrongFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-10-19T00:00:00+08:00',
    description: '最近错误时间止（不含），带时区的 ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME, { message: 'zonedDateTimeRequired' })
  lastWrongTo?: string;

  @ApiPropertyOptional({
    enum: WrongBookSortField,
    enumName: 'WrongBookSortField',
    default: WrongBookSortField.LAST_WRONG_AT,
  })
  @IsOptional()
  @IsEnum(WrongBookSortField)
  sortBy?: WrongBookSortField;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}

export class QueryWrongBookSummaryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  subjectId?: string;
}
