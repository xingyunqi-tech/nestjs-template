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
import { SubjectsService } from './subjects.service';
import { KnowledgePointsService } from './knowledge-points.service';
import { Subject } from './domain/subject';
import { ContentStatus } from './domain/content-status';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { QueryAdminSubjectDto } from './dto/query-admin-subject.dto';
import { KnowledgePointTreeNodeDto } from './dto/knowledge-point-tree-node.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Admin Subjects')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/subjects', version: '1' })
export class AdminSubjectsController {
  constructor(
    private readonly subjectsService: SubjectsService,
    private readonly knowledgePointsService: KnowledgePointsService,
  ) {}

  @ApiOperation({ operationId: 'adminGetSubjects', summary: '科目列表（管理员）' })
  @ApiOkResponse({ type: PaginationResponse(Subject) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminSubjectDto): Promise<PaginationResponseDto<Subject>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.subjectsService.findManyWithPaginationAndCount({
      filterOptions: query,
      paginationOptions: { page, limit },
    });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminCreateSubject', summary: '创建科目（草稿）' })
  @ApiOkResponse({ type: Subject })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateSubjectDto): Promise<Subject> {
    return this.subjectsService.create(dto);
  }

  @ApiOperation({ operationId: 'adminGetSubject', summary: '科目详情（管理员）' })
  @ApiOkResponse({ type: Subject })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string): Promise<Subject> {
    return this.subjectsService.findById(id);
  }

  @ApiOperation({ operationId: 'adminUpdateSubject', summary: '更新科目' })
  @ApiOkResponse({ type: Subject })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateSubjectDto): Promise<Subject> {
    return this.subjectsService.update(id, dto);
  }

  @ApiOperation({ operationId: 'adminDeleteSubject', summary: '删除科目（仅无知识点的草稿）' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.subjectsService.remove(id);
  }

  @ApiOperation({ operationId: 'adminPublishSubject', summary: '上架科目' })
  @ApiOkResponse({ type: Subject })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUuidPipe) id: string): Promise<Subject> {
    return this.subjectsService.changeStatus(id, ContentStatus.PUBLISHED);
  }

  @ApiOperation({ operationId: 'adminOfflineSubject', summary: '下架科目' })
  @ApiOkResponse({ type: Subject })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Post(':id/offline')
  @HttpCode(HttpStatus.OK)
  offline(@Param('id', ParseUuidPipe) id: string): Promise<Subject> {
    return this.subjectsService.changeStatus(id, ContentStatus.OFFLINE);
  }

  @ApiOperation({ operationId: 'adminGetSubjectKnowledgePoints', summary: '科目知识点树（管理员）' })
  @ApiOkResponse({ type: [KnowledgePointTreeNodeDto] })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id/knowledge-points')
  @HttpCode(HttpStatus.OK)
  findKnowledgePoints(@Param('id', ParseUuidPipe) id: string): Promise<KnowledgePointTreeNodeDto[]> {
    return this.knowledgePointsService.getTree(id);
  }
}
