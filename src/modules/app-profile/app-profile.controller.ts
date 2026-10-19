import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppProfileService } from './app-profile.service';
import { AppProfile } from './domain/app-profile';

@ApiTags('App Profile')
@Controller({ path: 'app-profile', version: '1' })
export class AppProfileController {
  constructor(private readonly appProfileService: AppProfileService) {}

  @ApiOperation({ operationId: 'getAppProfile', summary: '小程序站点信息，未配置的字段为 null' })
  @ApiOkResponse({ type: AppProfile })
  @Get()
  @HttpCode(HttpStatus.OK)
  get(): Promise<AppProfile> {
    return this.appProfileService.get();
  }
}
