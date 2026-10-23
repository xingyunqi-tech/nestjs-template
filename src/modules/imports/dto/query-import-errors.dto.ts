import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IMPORT_SHEETS } from '../package/sheet-row';
import type { ImportSheetName } from '../package/sheet-row';

export class QueryImportErrorsDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ type: Number, default: 50, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 50))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ type: String, enum: IMPORT_SHEETS, description: '只返回该工作表的错误行' })
  @IsOptional()
  @IsIn(IMPORT_SHEETS)
  sheet?: ImportSheetName;
}
