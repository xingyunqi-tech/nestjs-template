import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AdminPaginationQueryDto } from './admin-pagination-query.dto';
import { ContentStatus } from '../domain/content-status';

export class QueryAdminSubjectDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  examId?: string;

  @ApiPropertyOptional({ enum: ContentStatus, enumName: 'ContentStatus' })
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;
}

export type SubjectFilterOptions = Pick<QueryAdminSubjectDto, 'keyword' | 'status' | 'examId'>;
