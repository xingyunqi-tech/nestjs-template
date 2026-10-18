import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiUsageService } from './ai-usage.service';
import { AiUsageDto, QueryAiUsageDto } from './dto/ai-usage.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';

@ApiTags('Admin AI')
@ApiBearerAuth()
@RequirePermissions(Permission.AI_ADMIN)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/ai', version: '1' })
export class AdminAiController {
  constructor(private readonly usageService: AiUsageService) {}

  @ApiOperation({
    operationId: 'adminGetAiUsage',
    summary: 'AI 用量：按日、模型、类型返回请求数、失败数、token 与估算成本',
  })
  @ApiOkResponse({ type: AiUsageDto })
  @Get('usage')
  @HttpCode(HttpStatus.OK)
  getUsage(@Query() query: QueryAiUsageDto): Promise<AiUsageDto> {
    return this.usageService.findUsage(query.from, query.to);
  }
}
