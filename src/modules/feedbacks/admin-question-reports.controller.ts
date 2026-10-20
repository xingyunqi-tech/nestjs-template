import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { QuestionReportsService } from './question-reports.service';
import { QueryAdminQuestionReportDto } from './dto/query-question-report.dto';
import { UpdateQuestionReportDto } from './dto/update-question-report.dto';
import { AdminQuestionReportDetailDto, AdminQuestionReportDto } from './dto/question-report.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { Auditable, AuditAction } from '../../infrastructure/audit';

const ENTITY_TYPE = 'QuestionReport';

@ApiTags('Admin Question Reports')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_REVIEW)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/question-reports', version: '1' })
export class AdminQuestionReportsController {
  constructor(private readonly questionReportsService: QuestionReportsService) {}

  @ApiOperation({
    operationId: 'adminGetQuestionReports',
    summary: '纠错与举报列表：题目纠错与 AI 内容举报，可按类型、状态筛选',
  })
  @ApiOkResponse({ type: PaginationResponse(AdminQuestionReportDto) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminQuestionReportDto): Promise<PaginationResponseDto<AdminQuestionReportDto>> {
    const { data, total, paginationOptions } = await this.questionReportsService.findAdminPage(query);
    return pagination(data, total, paginationOptions);
  }

  @ApiOperation({ operationId: 'adminGetQuestionReport', summary: '纠错单详情，含题目与关联的勘误' })
  @ApiOkResponse({ type: AdminQuestionReportDetailDto })
  @ApiParam({ name: 'id', type: Number })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseIdPipe) id: number): Promise<AdminQuestionReportDetailDto> {
    return this.questionReportsService.getAdminDetail(id);
  }

  @ApiOperation({ operationId: 'adminUpdateQuestionReport', summary: '处理纠错单：修改状态、回复、关联勘误' })
  @ApiOkResponse({ type: AdminQuestionReportDetailDto })
  @ApiParam({ name: 'id', type: Number })
  @Auditable({ action: AuditAction.UPDATE, entityType: ENTITY_TYPE })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: UpdateQuestionReportDto,
  ): Promise<AdminQuestionReportDetailDto> {
    return this.questionReportsService.update(id, dto);
  }
}
