import { Controller, Get, HttpCode, HttpStatus, Param, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { QuestionAccessService } from './question-access.service';
import { QuestionContentDto } from './dto/question-content.dto';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Questions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'questions', version: '1' })
export class QuestionAccessController {
  constructor(private readonly questionAccessService: QuestionAccessService) {}

  @ApiOperation({
    operationId: 'getQuestion',
    summary: '题目内容，需与用户存在关联；题目在错题本、收藏或笔记中且不在进行中的模考时附带答案与解析',
  })
  @ApiOkResponse({ type: QuestionContentDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Request() request: RequestWithUser, @Param('id', ParseUuidPipe) id: string): Promise<QuestionContentDto> {
    return this.questionAccessService.getQuestion(Number(request.user.id), id);
  }
}
