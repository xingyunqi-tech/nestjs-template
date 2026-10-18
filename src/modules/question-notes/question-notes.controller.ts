import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { QuestionNotesBrowseService } from './question-notes-browse.service';
import { SaveQuestionNoteDto } from './dto/save-question-note.dto';
import { QueryQuestionNoteDto } from './dto/query-question-note.dto';
import { QuestionNoteDto, QuestionNoteItemDto } from './dto/question-note.dto';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Question Notes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1' })
export class QuestionNotesController {
  constructor(private readonly questionNotesBrowseService: QuestionNotesBrowseService) {}

  @ApiOperation({
    operationId: 'saveQuestionNote',
    summary: '保存题目笔记：该题须在用户某个会话中已可查看答案，且不在进行中的模考',
  })
  @ApiOkResponse({ type: QuestionNoteDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Put('questions/:id/note')
  @HttpCode(HttpStatus.OK)
  save(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SaveQuestionNoteDto,
  ): Promise<QuestionNoteDto> {
    return this.questionNotesBrowseService.save(Number(request.user.id), id, dto.content);
  }

  @ApiOperation({ operationId: 'deleteQuestionNote', summary: '删除题目笔记' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Delete('questions/:id/note')
  @HttpCode(HttpStatus.OK)
  remove(@Request() request: RequestWithUser, @Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.questionNotesBrowseService.remove(Number(request.user.id), id);
  }

  @ApiOperation({ operationId: 'getMyQuestionNotes', summary: '我的笔记列表，按更新时间倒序，附题目摘要（不含答案）' })
  @ApiOkResponse({ type: PaginationResponse(QuestionNoteItemDto) })
  @Get('me/question-notes')
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Request() request: RequestWithUser,
    @Query() query: QueryQuestionNoteDto,
  ): Promise<PaginationResponseDto<QuestionNoteItemDto>> {
    const { data, total, paginationOptions } = await this.questionNotesBrowseService.findPage(
      Number(request.user.id),
      query,
    );
    return pagination(data, total, paginationOptions);
  }
}
