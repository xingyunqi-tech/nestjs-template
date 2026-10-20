import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { PaperRulesService } from './paper-rules.service';
import { PaperRule } from './domain/paper-rule';
import { CreatePaperRuleDto } from './dto/create-paper-rule.dto';
import { UpdatePaperRuleDto } from './dto/update-paper-rule.dto';
import { QueryAdminPaperRuleDto } from './dto/query-admin-paper-rule.dto';
import { PaperDraftDto } from './dto/paper-draft.dto';
import { ContentStatus } from '../exams/domain/content-status';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Admin Paper Rules')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/paper-rules', version: '1' })
export class AdminPaperRulesController {
  constructor(
    private readonly paperRulesService: PaperRulesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @ApiOperation({ operationId: 'adminGetPaperRules', summary: '组卷规则列表' })
  @ApiOkResponse({ type: PaginationResponse(PaperRule) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminPaperRuleDto): Promise<PaginationResponseDto<PaperRule>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.paperRulesService.findManyWithPaginationAndCount({
      filterOptions: query,
      paginationOptions: { page, limit },
    });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminCreatePaperRule', summary: '创建组卷规则（草稿）' })
  @ApiOkResponse({ type: PaperRule })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreatePaperRuleDto): Promise<PaperRule> {
    return this.paperRulesService.create(dto);
  }

  @ApiOperation({ operationId: 'adminGetPaperRule', summary: '组卷规则详情' })
  @ApiOkResponse({ type: PaperRule })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string): Promise<PaperRule> {
    return this.paperRulesService.findById(id);
  }

  @ApiOperation({ operationId: 'adminUpdatePaperRule', summary: '更新组卷规则' })
  @ApiOkResponse({ type: PaperRule })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdatePaperRuleDto,
    @Request() request: RequestWithUser,
  ): Promise<PaperRule> {
    if (!(await this.canReview(request)) && (dto.status !== undefined || !(await this.isDraft(id)))) {
      throw new ForbiddenException({ error: 'paperRuleReviewRequired' });
    }
    return this.paperRulesService.update(id, dto);
  }

  @ApiOperation({ operationId: 'adminDeletePaperRule', summary: '删除组卷规则' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.paperRulesService.remove(id);
  }

  @ApiOperation({ operationId: 'adminPreviewPaperRule', summary: '按规则试生成，不落库' })
  @ApiOkResponse({ type: PaperDraftDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Param('id', ParseUuidPipe) id: string, @Request() request: RequestWithUser): Promise<PaperDraftDto> {
    return this.paperRulesService.preview(id, request.user.id);
  }

  private async isDraft(id: string): Promise<boolean> {
    return (await this.paperRulesService.findById(id)).status === ContentStatus.DRAFT;
  }

  private async canReview(request: RequestWithUser): Promise<boolean> {
    const roleId = request.user.role?.id;
    return roleId !== undefined && (await this.permissionsService.hasPermission(roleId, Permission.CONTENT_REVIEW));
  }
}
