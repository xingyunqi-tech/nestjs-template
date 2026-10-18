import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const lowercase = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.toLowerCase() : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class QueryDailyStatsDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-10-11',
    description: '起始统计日（含），默认 to 前 6 天',
  })
  @IsOptional()
  @Matches(DATE, { message: 'invalidDate' })
  @IsISO8601({ strict: true }, { message: 'invalidDate' })
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-10-17',
    description: '截止统计日（含），默认今天',
  })
  @IsOptional()
  @Matches(DATE, { message: 'invalidDate' })
  @IsISO8601({ strict: true }, { message: 'invalidDate' })
  to?: string;
}

export class QuerySubjectStudyDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(lowercase)
  @IsUUID()
  subjectId: string;
}

export class QueryCheckinsDto {
  @ApiPropertyOptional({ type: String, example: '2026-10', description: '月份 YYYY-MM，默认本月' })
  @IsOptional()
  @Matches(MONTH, { message: 'invalidMonth' })
  month?: string;
}
