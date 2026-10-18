import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AccountCleanupService } from './account-cleanup.service';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';

@ApiTags('Admin Account Cleanup')
@ApiBearerAuth()
@RequirePermissions(Permission.USER_DELETE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ version: '1' })
export class AdminAccountCleanupController {
  constructor(private readonly accountCleanupService: AccountCleanupService) {}

  @ApiOperation({
    operationId: 'adminRetriggerAccountCleanup',
    summary: '重新触发已注销用户的数据清理；已有清理任务在排队或执行时不重复入队',
  })
  @ApiOkResponse()
  @ApiParam({ name: 'id', type: Number })
  @Post('admin/users/:id/cleanup')
  @HttpCode(HttpStatus.OK)
  retrigger(@Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.accountCleanupService.retrigger(id);
  }
}
