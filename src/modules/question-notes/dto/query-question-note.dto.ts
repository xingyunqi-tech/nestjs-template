import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const lowercase = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.toLowerCase() : value);

export class QueryQuestionNoteDto {
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

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '查看单题的笔记' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  questionId?: string;
}
