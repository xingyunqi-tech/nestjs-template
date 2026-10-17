import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';

export class CreateSubjectDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  examId: string;

  @ApiProperty({ type: String, example: '行测' })
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

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  hasSubjective?: boolean;
}
