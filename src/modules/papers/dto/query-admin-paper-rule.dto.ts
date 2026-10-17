import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AdminPaginationQueryDto } from '../../exams/dto/admin-pagination-query.dto';
import { ContentStatus } from '../../exams/domain/content-status';

export class QueryAdminPaperRuleDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ enum: ContentStatus, enumName: 'ContentStatus' })
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;
}

export type PaperRuleFilterOptions = Pick<QueryAdminPaperRuleDto, 'keyword' | 'subjectId' | 'status'>;
