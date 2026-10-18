import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FeedbackStatus, FeedbackType, QUESTION_REPORT_TYPES } from '../domain/feedback';

export class QueryQuestionReportDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;
}

export class QueryAdminQuestionReportDto extends QueryQuestionReportDto {
  @ApiPropertyOptional({ enum: QUESTION_REPORT_TYPES, description: '题目纠错或 AI 内容举报，缺省为全部' })
  @IsOptional()
  @IsIn(QUESTION_REPORT_TYPES)
  type?: FeedbackType;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  questionId?: string;
}
