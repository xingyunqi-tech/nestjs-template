import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ExamsService } from './exams.service';
import { Exam } from './domain/exam';
import { ContentStatus } from './domain/content-status';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { QueryAdminExamDto } from './dto/query-admin-exam.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { Auditable, AuditAction } from '../../infrastructure/audit';

const ENTITY_TYPE = 'Exam';

@ApiTags('Admin Exams')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/exams', version: '1' })
export class AdminExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @ApiOperation({ operationId: 'adminGetExams', summary: '考试列表（管理员）' })
  @ApiOkResponse({ type: PaginationResponse(Exam) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminExamDto): Promise<PaginationResponseDto<Exam>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.examsService.findManyWithPaginationAndCount({
      filterOptions: query,
      paginationOptions: { page, limit },
    });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminCreateExam', summary: '创建考试（草稿）' })
  @ApiOkResponse({ type: Exam })
  @Auditable({ action: AuditAction.CREATE, entityType: ENTITY_TYPE })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateExamDto): Promise<Exam> {
    return this.examsService.create(dto);
  }

  @ApiOperation({ operationId: 'adminGetExam', summary: '考试详情（管理员）' })
  @ApiOkResponse({ type: Exam })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string): Promise<Exam> {
    return this.examsService.findById(id);
  }

  @ApiOperation({ operationId: 'adminUpdateExam', summary: '更新考试' })
  @ApiOkResponse({ type: Exam })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.UPDATE, entityType: ENTITY_TYPE })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateExamDto): Promise<Exam> {
    return this.examsService.update(id, dto);
  }

  @ApiOperation({ operationId: 'adminDeleteExam', summary: '删除考试（仅无科目的草稿）' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.DELETE, entityType: ENTITY_TYPE })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.examsService.remove(id);
  }

  @ApiOperation({ operationId: 'adminPublishExam', summary: '上架考试' })
  @ApiOkResponse({ type: Exam })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.PUBLISH, entityType: ENTITY_TYPE })
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUuidPipe) id: string): Promise<Exam> {
    return this.examsService.changeStatus(id, ContentStatus.PUBLISHED);
  }

  @ApiOperation({ operationId: 'adminOfflineExam', summary: '下架考试' })
  @ApiOkResponse({ type: Exam })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.OFFLINE, entityType: ENTITY_TYPE })
  @Post(':id/offline')
  @HttpCode(HttpStatus.OK)
  offline(@Param('id', ParseUuidPipe) id: string): Promise<Exam> {
    return this.examsService.changeStatus(id, ContentStatus.OFFLINE);
  }
}
