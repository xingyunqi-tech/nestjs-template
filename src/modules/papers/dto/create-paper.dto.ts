import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { CATALOG_PAPER_TYPES, type CatalogPaperType } from '../domain/paper-type';
import { MultiScoringRule } from '../domain/multi-scoring-rule';

export const PAPER_LIMITS = {
  titleLength: 100,
  minYear: 1949,
  maxYear: 2100,
  maxDurationMin: 600,
} as const;

export class CreatePaperDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  subjectId: string;

  @ApiProperty({ type: String, example: '2025 年国考行测真题' })
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAPER_LIMITS.titleLength)
  title: string;

  @ApiProperty({ enum: CATALOG_PAPER_TYPES, enumName: 'CatalogPaperType' })
  @IsIn(CATALOG_PAPER_TYPES)
  type: CatalogPaperType;

  @ApiPropertyOptional({ type: Number, nullable: true, description: '真题年份' })
  @IsOptional()
  @IsInt()
  @Min(PAPER_LIMITS.minYear)
  @Max(PAPER_LIMITS.maxYear)
  year?: number | null;

  @ApiProperty({ type: Number, example: 120 })
  @IsInt()
  @Min(1)
  @Max(PAPER_LIMITS.maxDurationMin)
  durationMin: number;

  @ApiPropertyOptional({
    enum: MultiScoringRule,
    enumName: 'MultiScoringRule',
    default: MultiScoringRule.ALL_OR_NOTHING,
  })
  @IsOptional()
  @IsEnum(MultiScoringRule)
  multiScoringRule?: MultiScoringRule;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
}
