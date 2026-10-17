import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DailyQuestionSetsService } from './daily-question-sets.service';
import { DailyQuestionSet } from './domain/daily-question-set';
import { AdminDailyQuestionSetDto, QueryDailySetsDto } from './dto/daily.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Admin Daily Question Sets')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/subjects/:id/daily-sets', version: '1' })
export class AdminDailyQuestionSetsController {
  constructor(private readonly dailyQuestionSetsService: DailyQuestionSetsService) {}

  @ApiOperation({ operationId: 'adminGetDailyQuestionSets', summary: '每日一练题组（按日期区间，含题目摘要）' })
  @ApiOkResponse({ type: [AdminDailyQuestionSetDto] })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get()
  @HttpCode(HttpStatus.OK)
  findRange(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: QueryDailySetsDto,
    @Request() request: RequestWithUser,
  ): Promise<AdminDailyQuestionSetDto[]> {
    return this.dailyQuestionSetsService.findRange(id, query.from, query.to, request.user.id);
  }

  @ApiOperation({ operationId: 'adminRegenerateDailyQuestionSet', summary: '重新生成当日及以后的题组' })
  @ApiOkResponse({ type: DailyQuestionSet })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'date', type: String, format: 'date' })
  @Post(':date/regenerate')
  @HttpCode(HttpStatus.OK)
  regenerate(@Param('id', ParseUuidPipe) id: string, @Param('date') date: string): Promise<DailyQuestionSet> {
    return this.dailyQuestionSetsService.regenerate(id, date);
  }
}
