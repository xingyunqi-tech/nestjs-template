import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, IsUUID, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { FavoriteTargetType } from '../domain/favorite';

export class QueryFavoriteDto {
  @ApiPropertyOptional({ enum: FavoriteTargetType })
  @IsOptional()
  @IsEnum(FavoriteTargetType)
  targetType?: FavoriteTargetType;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '题目、试卷所属科目' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value ? Number(value) : 10))
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}
