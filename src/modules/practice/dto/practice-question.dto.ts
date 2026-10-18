import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PublicQuestionDto } from '../../questions/dto/public-question.dto';
import { QuestionSolutionDto } from '../../questions/dto/question-solution.dto';
import { HiddenReason } from '../domain/hidden-reason';
import { AnswerStateDto } from './answer-state.dto';

export const SEGMENT_LIMITS = { defaultSize: 10, maxSize: 50 } as const;

export class PracticeQuestionDto extends PublicQuestionDto {
  @ApiProperty({ type: AnswerStateDto, nullable: true })
  answerState: AnswerStateDto | null;

  @ApiProperty({ type: QuestionSolutionDto, nullable: true, description: '满足答案可见性时返回' })
  solution: QuestionSolutionDto | null;

  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

export class PracticeQuestionUnitDto extends PracticeQuestionDto {
  @ApiPropertyOptional({ type: () => [PracticeQuestionDto], description: '材料题的小题，按会话顺序' })
  children?: PracticeQuestionDto[];
}

export class SessionQuestionsDto {
  @ApiProperty({ type: Number, description: '对齐材料边界后的起始位置（从 0 开始）' })
  from: number;

  @ApiProperty({ type: Number, description: '本段可作答题数' })
  size: number;

  @ApiProperty({ type: Number, description: '会话可作答题数' })
  total: number;

  @ApiProperty({ type: [PracticeQuestionUnitDto] })
  units: PracticeQuestionUnitDto[];
}

export class QuerySessionQuestionsDto {
  @ApiPropertyOptional({ type: Number, default: 0, description: '从 0 开始' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? 0 : Number(value)))
  @IsInt()
  @Min(0)
  from?: number = 0;

  @ApiPropertyOptional({ type: Number, default: SEGMENT_LIMITS.defaultSize, maximum: SEGMENT_LIMITS.maxSize })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? SEGMENT_LIMITS.defaultSize : Number(value)))
  @IsInt()
  @Min(1)
  @Max(SEGMENT_LIMITS.maxSize)
  size?: number = SEGMENT_LIMITS.defaultSize;
}
