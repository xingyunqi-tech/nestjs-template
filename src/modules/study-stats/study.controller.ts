import { Controller, Get, HttpCode, HttpStatus, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudyBrowseService } from './study-browse.service';
import { StudyOverviewDto } from './dto/study-overview.dto';
import { DailyStatDto } from './dto/daily-stat.dto';
import { WeakPointDto } from './dto/weak-point.dto';
import { CheckinCalendarDto } from './dto/checkin-calendar.dto';
import { QueryCheckinsDto, QueryDailyStatsDto, QuerySubjectStudyDto } from './dto/query-study.dto';
import { PublicKnowledgePointTreeNodeDto } from '../exams/dto/knowledge-point-tree-node.dto';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Study Stats')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'me', version: '1' })
export class StudyController {
  constructor(private readonly studyBrowseService: StudyBrowseService) {}

  @ApiOperation({
    operationId: 'getStudyOverview',
    summary: '首页学习概览：今日进度、每日目标、连续打卡、考试倒计时、累计做题数',
  })
  @ApiOkResponse({ type: StudyOverviewDto })
  @Get('study/overview')
  @HttpCode(HttpStatus.OK)
  overview(@Request() request: RequestWithUser): Promise<StudyOverviewDto> {
    return this.studyBrowseService.overview(Number(request.user.id));
  }

  @ApiOperation({ operationId: 'getStudyDaily', summary: '每日统计（按 Asia/Shanghai 统计日，区间最长 366 天）' })
  @ApiOkResponse({ type: [DailyStatDto] })
  @Get('study/daily')
  @HttpCode(HttpStatus.OK)
  daily(@Request() request: RequestWithUser, @Query() query: QueryDailyStatsDto): Promise<DailyStatDto[]> {
    return this.studyBrowseService.daily(Number(request.user.id), query);
  }

  @ApiOperation({ operationId: 'getStudyKnowledge', summary: '科目知识点树，附带做题进度与掌握度' })
  @ApiOkResponse({ type: [PublicKnowledgePointTreeNodeDto] })
  @Get('study/knowledge')
  @HttpCode(HttpStatus.OK)
  knowledge(
    @Request() request: RequestWithUser,
    @Query() query: QuerySubjectStudyDto,
  ): Promise<PublicKnowledgePointTreeNodeDto[]> {
    return this.studyBrowseService.knowledgeTree(Number(request.user.id), query.subjectId);
  }

  @ApiOperation({
    operationId: 'getStudyWeakPoints',
    summary: '薄弱知识点：叶子作答 ≥ 5 次且掌握度 < 60%，按掌握度升序',
  })
  @ApiOkResponse({ type: [WeakPointDto] })
  @Get('study/weak-points')
  @HttpCode(HttpStatus.OK)
  weakPoints(@Request() request: RequestWithUser, @Query() query: QuerySubjectStudyDto): Promise<WeakPointDto[]> {
    return this.studyBrowseService.weakPoints(Number(request.user.id), query.subjectId);
  }

  @ApiOperation({ operationId: 'getCheckins', summary: '打卡日历：指定月份的打卡日与连续打卡天数' })
  @ApiOkResponse({ type: CheckinCalendarDto })
  @Get('checkins')
  @HttpCode(HttpStatus.OK)
  checkins(@Request() request: RequestWithUser, @Query() query: QueryCheckinsDto): Promise<CheckinCalendarDto> {
    return this.studyBrowseService.checkins(Number(request.user.id), query.month);
  }
}
