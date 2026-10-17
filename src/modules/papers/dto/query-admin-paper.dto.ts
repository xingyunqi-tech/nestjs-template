import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AdminPaginationQueryDto } from '../../exams/dto/admin-pagination-query.dto';
import { ContentStatus } from '../../exams/domain/content-status';
import { PaperType } from '../domain/paper-type';

const toLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class QueryAdminPaperDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @Transform(toLowerCase)
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ enum: PaperType, enumName: 'PaperType' })
  @IsOptional()
  @IsEnum(PaperType)
  type?: PaperType;

  @ApiPropertyOptional({ enum: ContentStatus, enumName: 'ContentStatus' })
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;
}

export type PaperFilterOptions = Pick<QueryAdminPaperDto, 'keyword' | 'subjectId' | 'type' | 'status'>;
