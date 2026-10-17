import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ExamProfilesService } from './exam-profiles.service';
import { UserExamProfile } from './domain/user-exam-profile';
import { UpsertExamProfileDto } from './dto/upsert-exam-profile.dto';
import type { RequestWithUser } from '../../common/types/request-with-user.type';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Exam Profiles')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'me/exam-profiles', version: '1' })
export class ExamProfilesController {
  constructor(private readonly examProfilesService: ExamProfilesService) {}

  @ApiOperation({ operationId: 'getMyExamProfiles', summary: '我的目标考试（当前考试在前）' })
  @ApiOkResponse({ type: [UserExamProfile] })
  @Get()
  @HttpCode(HttpStatus.OK)
  findMine(@Request() request: RequestWithUser): Promise<UserExamProfile[]> {
    return this.examProfilesService.findMine(request.user.id);
  }

  @ApiOperation({ operationId: 'upsertMyExamProfile', summary: '关注考试或更新考试日期与每日目标' })
  @ApiOkResponse({ type: UserExamProfile })
  @ApiParam({ name: 'examId', type: String, format: 'uuid' })
  @Put(':examId')
  @HttpCode(HttpStatus.OK)
  upsert(
    @Request() request: RequestWithUser,
    @Param('examId', ParseUuidPipe) examId: string,
    @Body() dto: UpsertExamProfileDto,
  ): Promise<UserExamProfile> {
    return this.examProfilesService.upsert(request.user.id, examId, dto);
  }

  @ApiOperation({ operationId: 'setMyCurrentExam', summary: '设为当前考试' })
  @ApiOkResponse({ type: UserExamProfile })
  @ApiParam({ name: 'examId', type: String, format: 'uuid' })
  @Post(':examId/current')
  @HttpCode(HttpStatus.OK)
  setCurrent(
    @Request() request: RequestWithUser,
    @Param('examId', ParseUuidPipe) examId: string,
  ): Promise<UserExamProfile> {
    return this.examProfilesService.setCurrent(request.user.id, examId);
  }

  @ApiOperation({ operationId: 'deleteMyExamProfile', summary: '取消关注考试' })
  @ApiParam({ name: 'examId', type: String, format: 'uuid' })
  @Delete(':examId')
  @HttpCode(HttpStatus.OK)
  remove(@Request() request: RequestWithUser, @Param('examId', ParseUuidPipe) examId: string): Promise<void> {
    return this.examProfilesService.remove(request.user.id, examId);
  }
}
