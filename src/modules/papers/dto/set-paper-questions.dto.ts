import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { QuestionType } from '../../questions/domain/question-type';

export const PAPER_QUESTION_LIMITS = {
  sections: 50,
  sectionTitleLength: 50,
  questions: 500,
  minScore: 0.01,
  maxScore: 999.99,
  maxTotalScore: 9999.99,
} as const;

export class PaperSectionDto {
  @ApiProperty({ type: String, example: '常识判断' })
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAPER_QUESTION_LIMITS.sectionTitleLength)
  title: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  @IsEnum(QuestionType)
  questionType: QuestionType;
}

export class PaperQuestionItemDto {
  @ApiProperty({ type: String, format: 'uuid', description: '独立题或材料，不能直接传小题' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  questionId: string;

  @ApiProperty({ type: Number, description: 'sections 下标，须不减' })
  @IsInt()
  @Min(0)
  sectionIndex: number;

  @ApiProperty({ type: Number, description: '独立题分值；材料题为每道小题的默认分值' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(PAPER_QUESTION_LIMITS.minScore)
  @Max(PAPER_QUESTION_LIMITS.maxScore)
  score: number;

  @ApiPropertyOptional({ type: Number, isArray: true, description: '材料题按小题顺序逐题指定分值' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PAPER_QUESTION_LIMITS.questions)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }, { each: true })
  @Min(PAPER_QUESTION_LIMITS.minScore, { each: true })
  @Max(PAPER_QUESTION_LIMITS.maxScore, { each: true })
  childScores?: number[];
}

export class SetPaperQuestionsDto {
  @ApiProperty({ type: [PaperSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAPER_QUESTION_LIMITS.sections)
  @ValidateNested({ each: true })
  @Type(() => PaperSectionDto)
  sections: PaperSectionDto[];

  @ApiProperty({ type: [PaperQuestionItemDto], description: '数组顺序即题目顺序' })
  @IsArray()
  @ArrayMaxSize(PAPER_QUESTION_LIMITS.questions)
  @ValidateNested({ each: true })
  @Type(() => PaperQuestionItemDto)
  questions: PaperQuestionItemDto[];
}
