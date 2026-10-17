import { Controller, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ExamsService } from './exams.service';
import { SubjectsService } from './subjects.service';
import { KnowledgePointsService } from './knowledge-points.service';
import { ExamGroupDto } from './dto/exam-group.dto';
import { PublicKnowledgePointTreeNodeDto } from './dto/knowledge-point-tree-node.dto';
import { Subject } from './domain/subject';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Exams')
@Controller({ version: '1' })
export class ExamsController {
  constructor(
    private readonly examsService: ExamsService,
    private readonly subjectsService: SubjectsService,
    private readonly knowledgePointsService: KnowledgePointsService,
  ) {}

  @ApiOperation({ operationId: 'getExams', summary: '考试列表（按类别分组，仅已发布）' })
  @ApiOkResponse({ type: [ExamGroupDto] })
  @Get('exams')
  @HttpCode(HttpStatus.OK)
  findExams(): Promise<ExamGroupDto[]> {
    return this.examsService.findPublishedGroups();
  }

  @ApiOperation({ operationId: 'getExamSubjects', summary: '考试的科目列表（仅已发布）' })
  @ApiOkResponse({ type: [Subject] })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get('exams/:id/subjects')
  @HttpCode(HttpStatus.OK)
  findSubjects(@Param('id', ParseUuidPipe) id: string): Promise<Subject[]> {
    return this.subjectsService.findPublishedByExamId(id);
  }

  @ApiOperation({ operationId: 'getSubjectKnowledgePoints', summary: '科目知识点树（可选登录）' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: [PublicKnowledgePointTreeNodeDto] })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('subjects/:id/knowledge-points')
  @HttpCode(HttpStatus.OK)
  findKnowledgePoints(@Param('id', ParseUuidPipe) id: string): Promise<PublicKnowledgePointTreeNodeDto[]> {
    return this.knowledgePointsService.getPublishedTree(id);
  }
}
