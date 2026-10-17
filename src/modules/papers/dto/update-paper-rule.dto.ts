import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { ContentStatus } from '../../exams/domain/content-status';
import { MultiScoringRule } from '../domain/multi-scoring-rule';
import { PAPER_LIMITS } from './create-paper.dto';
import { PAPER_RULE_LIMITS, PaperRuleItemDto } from './paper-rule-item.dto';

const isPresent = (_: object, value: unknown): boolean => value !== undefined;

export class UpdatePaperRuleDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf(isPresent)
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAPER_LIMITS.titleLength)
  name?: string;

  @ApiPropertyOptional({ type: Number })
  @ValidateIf(isPresent)
  @IsInt()
  @Min(1)
  @Max(PAPER_LIMITS.maxDurationMin)
  durationMin?: number;

  @ApiPropertyOptional({ enum: MultiScoringRule, enumName: 'MultiScoringRule' })
  @ValidateIf(isPresent)
  @IsEnum(MultiScoringRule)
  multiScoringRule?: MultiScoringRule;

  @ApiPropertyOptional({ type: [PaperRuleItemDto] })
  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAPER_RULE_LIMITS.items)
  @ValidateNested({ each: true })
  @Type(() => PaperRuleItemDto)
  items?: PaperRuleItemDto[];

  @ApiPropertyOptional({ enum: ContentStatus, enumName: 'ContentStatus', description: '已发布的规则对用户可用' })
  @ValidateIf(isPresent)
  @IsEnum(ContentStatus)
  status?: ContentStatus;
}
