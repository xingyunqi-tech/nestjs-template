import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AppConfigService } from './config.service';
import { UpsertConfigDto } from './dto/upsert-config.dto';
import { Config } from './domain/config';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';

@ApiTags('Config')
@Controller({
  path: 'config',
  version: '1',
})
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @ApiOperation({ operationId: 'getConfig', summary: '获取公开配置' })
  @ApiOkResponse({ type: Config })
  @ApiParam({ name: 'key', type: String, example: 'app.theme' })
  @Get(':key')
  @HttpCode(HttpStatus.OK)
  findByKey(@Param('key') key: string): Promise<Config> {
    return this.appConfigService.findPublicByKey(key);
  }

  @ApiOperation({ operationId: 'getConfigAsAdmin', summary: '获取配置（管理员）' })
  @ApiBearerAuth()
  @RequirePermissions(Permission.SYSTEM_CONFIG)
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @ApiOkResponse({ type: Config })
  @ApiParam({ name: 'key', type: String, example: 'app.theme' })
  @Get('admin/:key')
  @HttpCode(HttpStatus.OK)
  findByKeyAsAdmin(@Param('key') key: string): Promise<Config> {
    return this.appConfigService.findByKey(key);
  }

  @ApiOperation({ operationId: 'upsertConfig', summary: '写入配置（管理员）' })
  @ApiBearerAuth()
  @RequirePermissions(Permission.SYSTEM_CONFIG)
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @ApiOkResponse({ type: Config })
  @ApiParam({ name: 'key', type: String, example: 'app.theme' })
  @Put(':key')
  @HttpCode(HttpStatus.OK)
  upsert(@Param('key') key: string, @Body() dto: UpsertConfigDto): Promise<Config> {
    return this.appConfigService.upsertGeneric(key, dto.value, dto.isPublic);
  }
}
