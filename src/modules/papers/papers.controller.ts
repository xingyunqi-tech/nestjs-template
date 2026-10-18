import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PapersService } from './papers.service';
import { DailyQuestionSetsService } from './daily-question-sets.service';
import { PublicPaperDetailDto, PublicPaperDto } from './dto/public-paper.dto';
import { QueryPublicPaperDto } from './dto/query-public-paper.dto';
import { DailySummaryDto, DailyTrialDto, TrialCheckDto, TrialCheckResultDto } from './dto/daily.dto';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { JwtPayloadType } from '../../core/auth/strategies/types/jwt-payload.type';

type OptionalUserRequest = { user?: JwtPayloadType };

@ApiTags('Papers')
@Controller({ version: '1' })
export class PapersController {
  constructor(
    private readonly papersService: PapersService,
    private readonly dailyQuestionSetsService: DailyQuestionSetsService,
  ) {}

  @ApiOperation({ operationId: 'getSubjectPapers', summary: '科目试卷列表（可选登录）' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: PaginationResponse(PublicPaperDto) })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('subjects/:id/papers')
  @HttpCode(HttpStatus.OK)
  async findPapers(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: QueryPublicPaperDto,
    @Request() request: OptionalUserRequest,
  ): Promise<PaginationResponseDto<PublicPaperDto>> {
    const { data, total, paginationOptions } = await this.papersService.findCatalog(
      id,
      query,
      request.user?.id ?? null,
    );
    return pagination(data, total, paginationOptions);
  }

  @ApiOperation({ operationId: 'getPaper', summary: '试卷概要（可选登录）' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: PublicPaperDetailDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('papers/:id')
  @HttpCode(HttpStatus.OK)
  findPaper(
    @Param('id', ParseUuidPipe) id: string,
    @Request() request: OptionalUserRequest,
  ): Promise<PublicPaperDetailDto> {
    return this.papersService.getPublicDetail(id, request.user?.id ?? null);
  }

  @ApiOperation({ operationId: 'getSubjectDaily', summary: '当日每日一练概要（可选登录）' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: DailySummaryDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('subjects/:id/daily')
  @HttpCode(HttpStatus.OK)
  findDaily(@Param('id', ParseUuidPipe) id: string): Promise<DailySummaryDto> {
    return this.dailyQuestionSetsService.getSummary(id);
  }

  @ApiOperation({ operationId: 'getSubjectDailyTrial', summary: '游客试做：当日每日一练前几题，不含答案' })
  @ApiOkResponse({ type: DailyTrialDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get('subjects/:id/daily/trial')
  @HttpCode(HttpStatus.OK)
  findTrial(@Param('id', ParseUuidPipe) id: string): Promise<DailyTrialDto> {
    return this.dailyQuestionSetsService.getTrial(id);
  }

  @ApiOperation({ operationId: 'checkSubjectDailyTrial', summary: '游客试做判分（可选登录），只返回对错，不落库' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: TrialCheckResultDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('subjects/:id/daily/trial/check')
  @HttpCode(HttpStatus.OK)
  checkTrial(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: TrialCheckDto,
    @Request() request: OptionalUserRequest,
  ): Promise<TrialCheckResultDto> {
    return this.dailyQuestionSetsService.checkTrial(id, dto, request.user ? Number(request.user.id) : null);
  }
}
