import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { WrongBookBrowseService } from './wrong-book-browse.service';
import { QueryWrongBookDto, QueryWrongBookSummaryDto } from './dto/query-wrong-book.dto';
import { WrongQuestionDto, WrongQuestionStateDto } from './dto/wrong-question.dto';
import { WrongBookSummaryDto } from './dto/wrong-book-summary.dto';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Wrong Book')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'wrong-book', version: '1' })
export class WrongBookController {
  constructor(private readonly wrongBookBrowseService: WrongBookBrowseService) {}

  @ApiOperation({
    operationId: 'getWrongBook',
    summary: '错题列表：默认 ACTIVE，可按科目、知识点子树、错误次数、最近错误时间筛选与排序',
  })
  @ApiOkResponse({ type: PaginationResponse(WrongQuestionDto) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Request() request: RequestWithUser,
    @Query() query: QueryWrongBookDto,
  ): Promise<PaginationResponseDto<WrongQuestionDto>> {
    const { data, total, paginationOptions } = await this.wrongBookBrowseService.findPage(
      Number(request.user.id),
      query,
    );
    return pagination(data, total, paginationOptions);
  }

  @ApiOperation({ operationId: 'getWrongBookSummary', summary: '错题总数、本周新增与本周消灭，按科目与知识点聚合' })
  @ApiOkResponse({ type: WrongBookSummaryDto })
  @Get('summary')
  @HttpCode(HttpStatus.OK)
  summarize(
    @Request() request: RequestWithUser,
    @Query() query: QueryWrongBookSummaryDto,
  ): Promise<WrongBookSummaryDto> {
    return this.wrongBookBrowseService.summarize(Number(request.user.id), query);
  }

  @ApiOperation({ operationId: 'masterWrongQuestion', summary: '手动移出错题本（置为已掌握）' })
  @ApiOkResponse({ type: WrongQuestionStateDto })
  @ApiParam({ name: 'questionId', type: String, format: 'uuid' })
  @Post(':questionId/master')
  @HttpCode(HttpStatus.OK)
  master(
    @Request() request: RequestWithUser,
    @Param('questionId', ParseUuidPipe) questionId: string,
  ): Promise<WrongQuestionStateDto> {
    return this.wrongBookBrowseService.master(Number(request.user.id), questionId);
  }

  @ApiOperation({ operationId: 'restoreWrongQuestion', summary: '恢复已掌握的错题，连续答对次数归零' })
  @ApiOkResponse({ type: WrongQuestionStateDto })
  @ApiParam({ name: 'questionId', type: String, format: 'uuid' })
  @Post(':questionId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Request() request: RequestWithUser,
    @Param('questionId', ParseUuidPipe) questionId: string,
  ): Promise<WrongQuestionStateDto> {
    return this.wrongBookBrowseService.restore(Number(request.user.id), questionId);
  }
}
