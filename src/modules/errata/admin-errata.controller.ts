import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ErrataService } from './errata.service';
import { Errata } from './domain/errata';
import { CreateErrataDto } from './dto/create-errata.dto';
import { QueryAdminErrataDto } from './dto/query-admin-errata.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Admin Errata')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_REVIEW)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ version: '1' })
export class AdminErrataController {
  constructor(private readonly errataService: ErrataService) {}

  @ApiOperation({
    operationId: 'adminCreateErrata',
    summary: '勘误：基于当前版本只改答案与解析，生成 ERRATA 版本并异步重判历史作答；同一题同时只能有一个未完成的勘误',
  })
  @ApiOkResponse({ type: Errata })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post('admin/questions/:id/errata')
  @HttpCode(HttpStatus.OK)
  create(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateErrataDto,
    @Request() request: RequestWithUser,
  ): Promise<Errata> {
    return this.errataService.create(id, dto, Number(request.user.id));
  }

  @ApiOperation({ operationId: 'adminGetErrataList', summary: '勘误任务列表' })
  @ApiOkResponse({ type: PaginationResponse(Errata) })
  @Get('admin/errata')
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminErrataDto): Promise<PaginationResponseDto<Errata>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.errataService.findManyWithPaginationAndCount(
      { status: query.status, questionId: query.questionId },
      { page, limit },
    );
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminGetErrata', summary: '勘误任务进度：受影响用户数与已处理用户数' })
  @ApiOkResponse({ type: Errata })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get('admin/errata/:id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string): Promise<Errata> {
    return this.errataService.findById(id);
  }

  @ApiOperation({ operationId: 'adminRetryErrata', summary: '失败或超过 10 分钟未进展的勘误任务从中断处继续' })
  @ApiOkResponse({ type: Errata })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post('admin/errata/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id', ParseUuidPipe) id: string): Promise<Errata> {
    return this.errataService.retry(id);
  }
}
