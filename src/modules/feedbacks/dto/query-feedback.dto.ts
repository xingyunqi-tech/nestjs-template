import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FeedbackType, FeedbackStatus, USER_QUERYABLE_FEEDBACK_TYPES } from '../domain/feedback';

export class QueryFeedbackDto {
  @ApiPropertyOptional({ enum: USER_QUERYABLE_FEEDBACK_TYPES })
  @IsOptional()
  @IsIn(USER_QUERYABLE_FEEDBACK_TYPES)
  type?: FeedbackType;

  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    default: 10,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
