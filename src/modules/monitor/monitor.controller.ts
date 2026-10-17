import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { QueueMonitorService } from './queue-monitor.service';
import { AdminAlert } from './domain/admin-alert';
import { QueryAdminAlertDto } from './dto/query-admin-alert.dto';
import { QueuesOverviewDto } from './dto/queue-stats.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';

@ApiTags('Monitor')
@ApiBearerAuth()
@RequirePermissions(Permission.SYSTEM_METRICS)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({
  path: 'admin/monitor',
  version: '1',
})
export class MonitorController {
  constructor(
    private readonly alertService: AlertService,
    private readonly queueMonitorService: QueueMonitorService,
  ) {}

  @ApiOperation({ operationId: 'getMonitorQueues', summary: '队列状态（管理员）' })
  @ApiOkResponse({ type: QueuesOverviewDto })
  @Get('queues')
  @HttpCode(HttpStatus.OK)
  getQueues(): Promise<QueuesOverviewDto> {
    return this.queueMonitorService.getOverview();
  }

  @ApiOperation({ operationId: 'getMonitorAlerts', summary: '告警列表（管理员）' })
  @ApiOkResponse({ type: PaginationResponse(AdminAlert) })
  @Get('alerts')
  @HttpCode(HttpStatus.OK)
  async getAlerts(@Query() query: QueryAdminAlertDto): Promise<PaginationResponseDto<AdminAlert>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.alertService.findManyWithPaginationAndCount({
      filterOptions: query,
      paginationOptions: { page, limit },
    });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'acknowledgeMonitorAlert', summary: '确认告警（管理员）' })
  @ApiOkResponse({ type: AdminAlert })
  @ApiParam({ name: 'id', type: Number })
  @Post('alerts/:id/ack')
  @HttpCode(HttpStatus.OK)
  acknowledge(@Param('id', ParseIdPipe) id: number): Promise<AdminAlert> {
    return this.alertService.acknowledge(id);
  }
}
