import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';

export class CreateKnowledgePointDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  subjectId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: '为空时创建一级知识点' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({ type: String, example: '言语理解与表达' })
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sort?: number;
}
