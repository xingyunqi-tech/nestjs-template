import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { QuestionReportsService } from './question-reports.service';
import { Feedback } from './domain/feedback';
import { CreateQuestionReportDto } from './dto/create-question-report.dto';
import { QueryQuestionReportDto } from './dto/query-question-report.dto';
import { QuestionReportItemDto } from './dto/question-report.dto';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Question Reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1' })
export class QuestionReportsController {
  constructor(private readonly questionReportsService: QuestionReportsService) {}

  @ApiOperation({
    operationId: 'createQuestionReport',
    summary: '题目纠错：题目须与用户存在会话、错题本、收藏或笔记关联，记录题目当前版本',
  })
  @ApiOkResponse({ type: Feedback })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post('questions/:id/reports')
  @HttpCode(HttpStatus.OK)
  create(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateQuestionReportDto,
  ): Promise<Feedback> {
    return this.questionReportsService.create(Number(request.user.id), id, dto);
  }

  @ApiOperation({ operationId: 'getMyQuestionReports', summary: '我的纠错记录与处理结果，按提交时间倒序，附题目摘要' })
  @ApiOkResponse({ type: PaginationResponse(QuestionReportItemDto) })
  @Get('me/question-reports')
  @HttpCode(HttpStatus.OK)
  async findMine(
    @Request() request: RequestWithUser,
    @Query() query: QueryQuestionReportDto,
  ): Promise<PaginationResponseDto<QuestionReportItemDto>> {
    const { data, total, paginationOptions } = await this.questionReportsService.findMine(
      Number(request.user.id),
      query,
    );
    return pagination(data, total, paginationOptions);
  }
}
