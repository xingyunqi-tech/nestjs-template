import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { sanitizeTransformer } from '../../../common/transformers/sanitize.transformer';

export class UpdateSubjectDto {
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

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  hasSubjective?: boolean;
}
