import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { AdminPaginationQueryDto } from './admin-pagination-query.dto';
import { ContentStatus } from '../domain/content-status';
import { ExamCategory } from '../domain/exam-category';

export class QueryAdminExamDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ enum: ContentStatus, enumName: 'ContentStatus' })
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @ApiPropertyOptional({ enum: ExamCategory, enumName: 'ExamCategory' })
  @IsOptional()
  @IsEnum(ExamCategory)
  category?: ExamCategory;
}

export type ExamFilterOptions = Pick<QueryAdminExamDto, 'keyword' | 'status' | 'category'>;
