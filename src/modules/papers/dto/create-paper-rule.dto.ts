import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { MultiScoringRule } from '../domain/multi-scoring-rule';
import { PAPER_LIMITS } from './create-paper.dto';
import { PAPER_RULE_LIMITS, PaperRuleItemDto } from './paper-rule-item.dto';

export class CreatePaperRuleDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  subjectId: string;

  @ApiProperty({ type: String, example: '行测标准模考' })
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAPER_LIMITS.titleLength)
  name: string;

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

  @ApiProperty({ type: [PaperRuleItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAPER_RULE_LIMITS.items)
  @ValidateNested({ each: true })
  @Type(() => PaperRuleItemDto)
  items: PaperRuleItemDto[];
}
