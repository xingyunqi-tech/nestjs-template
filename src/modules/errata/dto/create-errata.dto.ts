import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { QuestionAnswer } from '../../questions/domain/question-answer';

export class CreateErrataDto {
  @ApiProperty({ type: Object, description: '勘误后的答案，结构随题型变化', example: { keys: ['C'] } })
  @IsObject()
  answer: QuestionAnswer;

  @ApiPropertyOptional({ type: String, nullable: true, description: '勘误后的解析，缺省时沿用当前解析' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  analysis?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 1000, description: '完成后写入关联纠错单的回复' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  reply?: string;

  @ApiPropertyOptional({ type: [Number], description: '关联的题目纠错单' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  reportIds?: number[];
}
