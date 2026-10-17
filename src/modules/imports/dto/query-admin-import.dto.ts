import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ImportJobStatus } from '../domain/import-job-status';

export class QueryAdminImportDto {
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

  @ApiPropertyOptional({ enum: ImportJobStatus, enumName: 'ImportJobStatus' })
  @IsOptional()
  @IsEnum(ImportJobStatus)
  status?: ImportJobStatus;
}
