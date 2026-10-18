import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class QueryAiUsageDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-12' })
  @Matches(DATE_PATTERN)
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-18', description: '含当日，跨度不超过 366 天' })
  @Matches(DATE_PATTERN)
  @IsISO8601({ strict: true })
  to: string;
}

export class AiUsageItemDto {
  @ApiProperty({ type: String, format: 'date' })
  date: string;

  @ApiProperty({ type: String })
  model: string;

  @ApiProperty({ type: String, enum: ['chat', 'grading'] })
  kind: string;

  @ApiProperty({ type: Number })
  requests: number;

  @ApiProperty({ type: Number })
  failures: number;

  @ApiProperty({ type: Number })
  inputTokens: number;

  @ApiProperty({ type: Number })
  outputTokens: number;

  @ApiProperty({ type: Number, description: '估算成本（元）' })
  cost: number;
}

export class AiUsageTotalDto {
  @ApiProperty({ type: Number })
  requests: number;

  @ApiProperty({ type: Number })
  failures: number;

  @ApiProperty({ type: Number })
  inputTokens: number;

  @ApiProperty({ type: Number })
  outputTokens: number;

  @ApiProperty({ type: Number, description: '估算成本（元）' })
  cost: number;
}

export class AiUsageDto {
  @ApiProperty({ type: AiUsageItemDto, isArray: true, description: '按日期、模型、类型升序，无调用的日期不含' })
  items: AiUsageItemDto[];

  @ApiProperty({ type: () => AiUsageTotalDto, description: '区间合计' })
  total: AiUsageTotalDto;
}
