import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';
import { ExamCategory } from '../domain/exam-category';

export class CreateExamDto {
  @ApiProperty({ type: String, example: '国考' })
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ enum: ExamCategory, enumName: 'ExamCategory' })
  @IsEnum(ExamCategory)
  category: ExamCategory;

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

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sort?: number;
}
