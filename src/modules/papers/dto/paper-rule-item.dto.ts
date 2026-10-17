import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { QuestionType } from '../../questions/domain/question-type';
import { PAPER_QUESTION_LIMITS } from './set-paper-questions.dto';

export const PAPER_RULE_LIMITS = {
  items: 20,
  knowledgePoints: 50,
  countPerItem: 200,
} as const;

const toLowerCaseEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((item: unknown) => (typeof item === 'string' ? item.toLowerCase() : item)) : value;

export class PaperRuleItemDto {
  @ApiProperty({ type: String, example: '常识判断' })
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAPER_QUESTION_LIMITS.sectionTitleLength)
  sectionTitle: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType', description: 'MATERIAL 时以材料为单位抽题' })
  @IsEnum(QuestionType)
  questionType: QuestionType;

  @ApiPropertyOptional({ type: String, format: 'uuid', isArray: true, description: '含下级知识点' })
  @IsOptional()
  @Transform(toLowerCaseEach)
  @IsArray()
  @ArrayMaxSize(PAPER_RULE_LIMITS.knowledgePoints)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  knowledgePointIds?: string[];

  @ApiPropertyOptional({ type: Number, isArray: true, minItems: 2, maxItems: 2, example: [1, 5] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  difficultyRange?: [number, number];

  @ApiProperty({ type: Number, description: '可作答题数' })
  @IsInt()
  @Min(1)
  @Max(PAPER_RULE_LIMITS.countPerItem)
  count: number;

  @ApiProperty({ type: Number })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(PAPER_QUESTION_LIMITS.minScore)
  @Max(PAPER_QUESTION_LIMITS.maxScore)
  scorePerQuestion: number;
}
