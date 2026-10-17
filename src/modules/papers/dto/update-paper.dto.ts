import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { CATALOG_PAPER_TYPES, type CatalogPaperType } from '../domain/paper-type';
import { MultiScoringRule } from '../domain/multi-scoring-rule';
import { PAPER_LIMITS } from './create-paper.dto';

const isPresent = (_: object, value: unknown): boolean => value !== undefined;

export class UpdatePaperDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf(isPresent)
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAPER_LIMITS.titleLength)
  title?: string;

  @ApiPropertyOptional({ enum: CATALOG_PAPER_TYPES, enumName: 'CatalogPaperType', description: '仅草稿可改' })
  @ValidateIf(isPresent)
  @IsIn(CATALOG_PAPER_TYPES)
  type?: CatalogPaperType;

  @ApiPropertyOptional({ type: Number, nullable: true, description: '传 null 清空' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(PAPER_LIMITS.minYear)
  @Max(PAPER_LIMITS.maxYear)
  year?: number | null;

  @ApiPropertyOptional({ type: Number })
  @ValidateIf(isPresent)
  @IsInt()
  @Min(1)
  @Max(PAPER_LIMITS.maxDurationMin)
  durationMin?: number;

  @ApiPropertyOptional({ enum: MultiScoringRule, enumName: 'MultiScoringRule', description: '仅草稿可改' })
  @ValidateIf(isPresent)
  @IsEnum(MultiScoringRule)
  multiScoringRule?: MultiScoringRule;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf(isPresent)
  @IsBoolean()
  isFree?: boolean;
}
