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
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { QuestionsService } from './questions.service';
import { QuestionAction } from './domain/question-status';
import { AdminQuestionDto, AdminQuestionVersionDto } from './dto/admin-question.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QueryAdminQuestionDto } from './dto/query-admin-question.dto';
import { BatchPublishQuestionsDto, BatchPublishQuestionsResultDto } from './dto/batch-publish-questions.dto';
import { RejectQuestionDto } from './dto/reject-question.dto';
import { QuestionOperator } from './domain/question-operator';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequireAnyPermission, RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';
import { Auditable, AuditAction } from '../../infrastructure/audit';

const ENTITY_TYPE = 'Question';

function operatorOf(request: RequestWithUser): QuestionOperator {
  return { id: Number(request.user.id), roleId: request.user.role?.id ?? null };
}

@ApiTags('Admin Questions')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/questions', version: '1' })
export class AdminQuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @ApiOperation({ operationId: 'adminGetQuestions', summary: '题目列表（管理员）' })
  @ApiOkResponse({ type: PaginationResponse(AdminQuestionDto) })
  @RequireAnyPermission(Permission.CONTENT_MANAGE, Permission.CONTENT_REVIEW)
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Query() query: QueryAdminQuestionDto,
    @Request() request: RequestWithUser,
  ): Promise<PaginationResponseDto<AdminQuestionDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.questionsService.findManyWithPaginationAndCount(
      { filterOptions: query, paginationOptions: { page, limit } },
      request.user.id,
    );
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminCreateQuestion', summary: '新建题目（草稿）' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @Auditable({ action: AuditAction.CREATE, entityType: ENTITY_TYPE, includeBody: false })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateQuestionDto, @Request() request: RequestWithUser): Promise<AdminQuestionDto> {
    return this.questionsService.create(dto, Number(request.user.id));
  }

  @ApiOperation({
    operationId: 'adminBatchPublishQuestions',
    summary: '批量发布待审题目',
    description:
      '非 admin 发布自己提交的题目时整批返回 403（selfReviewForbidden），响应 data.questionIds 为命中的题目 id；传入小题时返回其所属材料的 id',
  })
  @ApiOkResponse({ type: BatchPublishQuestionsResultDto })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.PUBLISH, entityType: ENTITY_TYPE })
  @Post('batch-publish')
  @HttpCode(HttpStatus.OK)
  batchPublish(
    @Body() dto: BatchPublishQuestionsDto,
    @Request() request: RequestWithUser,
  ): Promise<BatchPublishQuestionsResultDto> {
    return this.questionsService.batchPublish(dto, operatorOf(request));
  }

  @ApiOperation({ operationId: 'adminGetQuestion', summary: '题目详情（含小题）' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequireAnyPermission(Permission.CONTENT_MANAGE, Permission.CONTENT_REVIEW)
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminQuestionDto> {
    return this.questionsService.getAdminDetail(id, request.user.id);
  }

  @ApiOperation({ operationId: 'adminUpdateQuestion', summary: '编辑题目，已发布过的题目生成新版本' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.UPDATE, entityType: ENTITY_TYPE, includeBody: false })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateQuestionDto,
    @Request() request: RequestWithUser,
  ): Promise<AdminQuestionDto> {
    return this.questionsService.update(id, dto, request.user.id);
  }

  @ApiOperation({ operationId: 'adminDeleteQuestion', summary: '删除未发布过的草稿题目' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.DELETE, entityType: ENTITY_TYPE })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.questionsService.remove(id);
  }

  @ApiOperation({ operationId: 'adminGetQuestionVersions', summary: '题目版本历史' })
  @ApiOkResponse({ type: [AdminQuestionVersionDto] })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id/versions')
  @HttpCode(HttpStatus.OK)
  findVersions(
    @Param('id', ParseUuidPipe) id: string,
    @Request() request: RequestWithUser,
  ): Promise<AdminQuestionVersionDto[]> {
    return this.questionsService.findVersions(id, request.user.id);
  }

  @ApiOperation({ operationId: 'adminSubmitQuestion', summary: '提交审核' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Auditable({ action: AuditAction.SUBMIT, entityType: ENTITY_TYPE })
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminQuestionDto> {
    return this.questionsService.changeStatus(id, QuestionAction.SUBMIT, operatorOf(request));
  }

  @ApiOperation({ operationId: 'adminPublishQuestion', summary: '发布题目' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.PUBLISH, entityType: ENTITY_TYPE })
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminQuestionDto> {
    return this.questionsService.changeStatus(id, QuestionAction.PUBLISH, operatorOf(request));
  }

  @ApiOperation({ operationId: 'adminRejectQuestion', summary: '驳回为草稿，须填写原因' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.REJECT, entityType: ENTITY_TYPE })
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: RejectQuestionDto,
    @Request() request: RequestWithUser,
  ): Promise<AdminQuestionDto> {
    return this.questionsService.reject(id, dto.reason, operatorOf(request));
  }

  @ApiOperation({ operationId: 'adminOfflineQuestion', summary: '下架题目' })
  @ApiOkResponse({ type: AdminQuestionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.CONTENT_REVIEW)
  @Auditable({ action: AuditAction.OFFLINE, entityType: ENTITY_TYPE })
  @Post(':id/offline')
  @HttpCode(HttpStatus.OK)
  offline(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<AdminQuestionDto> {
    return this.questionsService.changeStatus(id, QuestionAction.OFFLINE, operatorOf(request));
  }
}
