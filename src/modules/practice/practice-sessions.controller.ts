import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PracticeSessionsService } from './practice-sessions.service';
import { PracticeAnswersService } from './practice-answers.service';
import { CreatePracticeSessionDto } from './dto/create-practice-session.dto';
import {
  CreatePracticeSessionResultDto,
  PracticeSessionDetailDto,
  PracticeSessionDto,
  ProgressDto,
  QueryPracticeSessionsDto,
} from './dto/practice-session.dto';
import { QuerySessionQuestionsDto, SessionQuestionsDto } from './dto/practice-question.dto';
import { AnswerResultDto, SaveAnswersDto, SaveAnswersResultDto, SelfAssessmentDto } from './dto/save-answers.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Practice')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'practice/sessions', version: '1' })
export class PracticeSessionsController {
  constructor(
    private readonly practiceSessionsService: PracticeSessionsService,
    private readonly practiceAnswersService: PracticeAnswersService,
  ) {}

  @ApiOperation({ operationId: 'createPracticeSession', summary: '创建练习会话；每日一练重复进入返回同一会话' })
  @ApiOkResponse({ type: CreatePracticeSessionResultDto })
  @RequirePermissions(Permission.PRACTICE_WRITE)
  @UseGuards(PermissionsGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Request() request: RequestWithUser,
    @Body() dto: CreatePracticeSessionDto,
  ): Promise<CreatePracticeSessionResultDto> {
    return this.practiceSessionsService.create(Number(request.user.id), dto);
  }

  @ApiOperation({ operationId: 'getPracticeSessions', summary: '练习历史' })
  @ApiOkResponse({ type: PaginationResponse(PracticeSessionDto) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findHistory(
    @Request() request: RequestWithUser,
    @Query() query: QueryPracticeSessionsDto,
  ): Promise<PaginationResponseDto<PracticeSessionDto>> {
    const { data, total, paginationOptions } = await this.practiceSessionsService.findHistory(
      Number(request.user.id),
      query,
    );
    return pagination(data, total, paginationOptions);
  }

  @ApiOperation({ operationId: 'getOngoingPracticeSessions', summary: '未完成会话，按最近活跃倒序' })
  @ApiOkResponse({ type: [PracticeSessionDto] })
  @Get('ongoing')
  @HttpCode(HttpStatus.OK)
  findOngoing(@Request() request: RequestWithUser): Promise<PracticeSessionDto[]> {
    return this.practiceSessionsService.findOngoing(Number(request.user.id));
  }

  @ApiOperation({ operationId: 'getPracticeSession', summary: '会话详情、答题卡与服务端时间' })
  @ApiOkResponse({ type: PracticeSessionDetailDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PracticeSessionDetailDto> {
    return this.practiceSessionsService.getDetail(Number(request.user.id), id);
  }

  @ApiOperation({ operationId: 'getPracticeSessionQuestions', summary: '分段拉取题目，边界对齐材料' })
  @ApiOkResponse({ type: SessionQuestionsDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id/questions')
  @HttpCode(HttpStatus.OK)
  findQuestions(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: QuerySessionQuestionsDto,
  ): Promise<SessionQuestionsDto> {
    return this.practiceSessionsService.getQuestions(Number(request.user.id), id, query);
  }

  @ApiOperation({ operationId: 'savePracticeAnswers', summary: '保存作答（单条或批量）' })
  @ApiOkResponse({ type: SaveAnswersResultDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.PRACTICE_WRITE)
  @UseGuards(PermissionsGuard)
  @Put(':id/answers')
  @HttpCode(HttpStatus.OK)
  saveAnswers(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SaveAnswersDto,
  ): Promise<SaveAnswersResultDto> {
    return this.practiceAnswersService.save(Number(request.user.id), id, dto);
  }

  @ApiOperation({ operationId: 'selfAssessPracticeAnswer', summary: '主观题自评' })
  @ApiOkResponse({ type: AnswerResultDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.PRACTICE_WRITE)
  @UseGuards(PermissionsGuard)
  @Post(':id/self-assessment')
  @HttpCode(HttpStatus.OK)
  selfAssess(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SelfAssessmentDto,
  ): Promise<AnswerResultDto> {
    return this.practiceAnswersService.selfAssess(Number(request.user.id), id, dto);
  }

  @ApiOperation({ operationId: 'updatePracticeProgress', summary: '记录最近浏览位置' })
  @ApiOkResponse({ type: PracticeSessionDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.PRACTICE_WRITE)
  @UseGuards(PermissionsGuard)
  @Post(':id/progress')
  @HttpCode(HttpStatus.OK)
  updateProgress(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ProgressDto,
  ): Promise<PracticeSessionDto> {
    return this.practiceSessionsService.updateProgress(Number(request.user.id), id, dto.lastIndex);
  }

  @ApiOperation({ operationId: 'submitPracticeSession', summary: '结束练习（每日一练不可结束）' })
  @ApiOkResponse({ type: PracticeSessionDetailDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.PRACTICE_WRITE)
  @UseGuards(PermissionsGuard)
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PracticeSessionDetailDto> {
    return this.practiceSessionsService.submit(Number(request.user.id), id);
  }

  @ApiOperation({ operationId: 'abandonPracticeSession', summary: '放弃会话（每日一练不可放弃）' })
  @ApiOkResponse({ type: PracticeSessionDetailDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.PRACTICE_WRITE)
  @UseGuards(PermissionsGuard)
  @Post(':id/abandon')
  @HttpCode(HttpStatus.OK)
  abandon(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PracticeSessionDetailDto> {
    return this.practiceSessionsService.abandon(Number(request.user.id), id);
  }
}
