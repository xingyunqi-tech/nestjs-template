import { Body, Controller, HttpCode, HttpStatus, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppProfileService } from './app-profile.service';
import { AppProfile } from './domain/app-profile';
import { UpdateAppProfileDto } from './dto/update-app-profile.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';

@ApiTags('Admin App Profile')
@ApiBearerAuth()
@RequirePermissions(Permission.SYSTEM_CONFIG)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/app-profile', version: '1' })
export class AdminAppProfileController {
  constructor(private readonly appProfileService: AppProfileService) {}

  @ApiOperation({
    operationId: 'adminUpdateAppProfile',
    summary: '保存小程序站点信息：整体覆盖，未传或空白的字段保存为未配置（null）',
  })
  @ApiOkResponse({ type: AppProfile })
  @Put()
  @HttpCode(HttpStatus.OK)
  update(@Body() dto: UpdateAppProfileDto): Promise<AppProfile> {
    return this.appProfileService.update(dto);
  }
}
