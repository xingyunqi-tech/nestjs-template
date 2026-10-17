import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { ExamCategory } from '../domain/exam-category';

export class UpdateExamDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ enum: ExamCategory, enumName: 'ExamCategory' })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(ExamCategory)
  category?: ExamCategory;

  @ApiPropertyOptional({ type: String, nullable: true, description: '图标 URL 或 file:{fileId}' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(sanitizeTransformer)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  sort?: number;
}
