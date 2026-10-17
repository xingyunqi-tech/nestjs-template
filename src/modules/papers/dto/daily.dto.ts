import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsUUID, Matches, ValidateNested } from 'class-validator';
import { PublicQuestionUnitDto } from '../../questions/dto/public-question.dto';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class QueryDailySetsDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  @Matches(DATE_PATTERN)
  from: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  @Matches(DATE_PATTERN)
  to: string;
}

export class DailySummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String, format: 'date' })
  date: string;

  @ApiProperty({ type: Number, description: '当日题量，题库为空时为 0' })
  questionCount: number;

  @ApiProperty({ type: Object, nullable: true, description: '登录用户的完成情况' })
  completion: null;
}

export class DailyTrialDto {
  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String, format: 'date' })
  date: string;

  @ApiProperty({ type: Number, description: '可作答题数' })
  questionCount: number;

  @ApiProperty({ type: [PublicQuestionUnitDto], description: '不含答案与解析' })
  questions: PublicQuestionUnitDto[];
}

export class TrialAnswerDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  questionId: string;

  @ApiProperty({ type: Object, example: { keys: ['B'] } })
  @IsDefined()
  answer: unknown;
}

export class TrialCheckDto {
  @ApiProperty({ type: String, format: 'date', description: '试做题组日期，仅今天或昨天' })
  @Matches(DATE_PATTERN)
  date: string;

  @ApiProperty({ type: [TrialAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TrialAnswerDto)
  answers: TrialAnswerDto[];
}

export class TrialResultDto {
  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: Boolean, nullable: true, description: '主观题为 null' })
  isCorrect: boolean | null;
}

export class TrialCheckResultDto {
  @ApiProperty({ type: [TrialResultDto] })
  results: TrialResultDto[];
}
