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
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PapersService } from './papers.service';
import { Paper } from './domain/paper';
import { AdminPaperDto } from './dto/admin-paper.dto';
import { CreatePaperDto } from './dto/create-paper.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';
import { QueryAdminPaperDto } from './dto/query-admin-paper.dto';
import { SetPaperQuestionsDto } from './dto/set-paper-questions.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';
import { Auditable, AuditAction } from '../../infrastructure/audit';

const ENTITY_TYPE = 'Paper';

const summarizePaperQuestions = (dto: SetPaperQuestionsDto): Record<string, unknown> => ({
  sectionCount: dto.sections.length,
  questionCount: dto.questions.length,
});

const copiedFrom = (_body: unknown, params: Record<string, string>): Record<string, unknown> => ({
  sourceId: params.id,
});

@ApiTags('Admin Papers')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/papers', version: '1' })
export class AdminPapersController {
  constructor(private readonly papersService: PapersService) {}

  @ApiOperation({ operationId: 'adminGetPapers', summary: '试卷列表（管理员）' })
  @ApiOkResponse({ type: PaginationResponse(Paper) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminPaperDto): Promise<PaginationResponseDto<Paper>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.papersService.findManyWithPaginationAndCount({
      filterOptions: query,
      paginationOptions: { page, limit },
    });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminCreatePaper', summary: '创建试卷（草稿）' })
  @ApiOkResponse({ type: AdminPaperDto })
  @Auditable({ action: AuditAction.CREATE, entityType: ENTITY_TYPE })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreatePaperDto, @Request() request: RequestWithUser): Promise<AdminPaperDto> {
    return this.papersService.create(dto, request.user.id);
  }

  @ApiOperation({ operationId: 'adminGetPaper', summary: '试卷详情（含题目）' })
  @ApiOkResponse({ type: AdminPaperDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminPaperDto> {
    return this.papersService.getAdminDetail(id, request.user.id);
  }

  @ApiOperation({ operationId: 'adminUpdatePaper', summary: '更新试卷信息' })
  @ApiOkResponse({ type: AdminPaperDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.UPDATE, entityType: ENTITY_TYPE })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdatePaperDto,
    @Request() request: RequestWithUser,
  ): Promise<AdminPaperDto> {
    return this.papersService.update(id, dto, request.user.id);
  }

  @ApiOperation({ operationId: 'adminDeletePaper', summary: '删除草稿试卷' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.DELETE, entityType: ENTITY_TYPE })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.papersService.remove(id);
  }

  @ApiOperation({ operationId: 'adminSetPaperQuestions', summary: '整体设置分区、题目、顺序与分值（仅草稿）' })
  @ApiOkResponse({ type: AdminPaperDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.UPDATE, entityType: ENTITY_TYPE, summarizeBody: summarizePaperQuestions })
  @Put(':id/questions')
  @HttpCode(HttpStatus.OK)
  setQuestions(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SetPaperQuestionsDto,
    @Request() request: RequestWithUser,
  ): Promise<AdminPaperDto> {
    return this.papersService.setQuestions(id, dto, request.user.id);
  }

  @ApiOperation({ operationId: 'adminPublishPaper', summary: '发布试卷' })
  @ApiOkResponse({ type: AdminPaperDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.PUBLISH, entityType: ENTITY_TYPE })
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminPaperDto> {
    return this.papersService.publish(id, request.user.id);
  }

  @ApiOperation({ operationId: 'adminOfflinePaper', summary: '下架试卷' })
  @ApiOkResponse({ type: AdminPaperDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.OFFLINE, entityType: ENTITY_TYPE })
  @Post(':id/offline')
  @HttpCode(HttpStatus.OK)
  offline(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminPaperDto> {
    return this.papersService.offline(id, request.user.id);
  }

  @ApiOperation({ operationId: 'adminCopyPaper', summary: '复制为新的草稿试卷' })
  @ApiOkResponse({ type: AdminPaperDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.COPY, entityType: ENTITY_TYPE, entityIdFrom: 'response', summarizeBody: copiedFrom })
  @Post(':id/copy')
  @HttpCode(HttpStatus.OK)
  copy(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminPaperDto> {
    return this.papersService.copy(id, request.user.id);
  }
}
