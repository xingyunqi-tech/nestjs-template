import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';

export class UpdateKnowledgePointDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(sanitizeTransformer)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  sort?: number;
}
