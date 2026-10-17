import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { QuestionType } from '../domain/question-type';
import { QuestionStatus } from '../domain/question-status';
import { QuestionSource } from '../domain/question-source';

const toLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class QueryAdminQuestionDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ type: String, description: '按题干或材料模糊匹配' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @Transform(toLowerCase)
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '含该知识点及其下级知识点' })
  @IsOptional()
  @Transform(toLowerCase)
  @IsUUID()
  knowledgePointId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '只列出该材料的小题' })
  @IsOptional()
  @Transform(toLowerCase)
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'true 时只列出独立题与材料，不含小题' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  topLevel?: boolean;

  @ApiPropertyOptional({ enum: QuestionType, enumName: 'QuestionType' })
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @ApiPropertyOptional({ enum: QuestionStatus, enumName: 'QuestionStatus' })
  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;

  @ApiPropertyOptional({ enum: QuestionSource, enumName: 'QuestionSource' })
  @IsOptional()
  @IsEnum(QuestionSource)
  source?: QuestionSource;
}

export type QuestionFilterOptions = Omit<QueryAdminQuestionDto, 'page' | 'limit'>;
