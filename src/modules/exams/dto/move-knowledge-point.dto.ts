import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class MoveKnowledgePointDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '为 null 时移动为一级知识点' })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId: string | null;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sort?: number;
}
