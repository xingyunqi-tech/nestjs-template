import { Controller, Get, HttpCode, HttpStatus, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StudyBrowseService } from './study-browse.service';
import { PublicKnowledgePointTreeNodeDto } from '../exams/dto/knowledge-point-tree-node.dto';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Exams')
@Controller({ version: '1' })
export class SubjectKnowledgePointsController {
  constructor(private readonly studyBrowseService: StudyBrowseService) {}

  @ApiOperation({
    operationId: 'getSubjectKnowledgePoints',
    summary: '科目知识点树（可选登录，登录时附带个人做题进度与掌握度）',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: [PublicKnowledgePointTreeNodeDto] })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('subjects/:id/knowledge-points')
  @HttpCode(HttpStatus.OK)
  findKnowledgePoints(
    @Request() request: Partial<RequestWithUser>,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PublicKnowledgePointTreeNodeDto[]> {
    const userId = request.user ? Number(request.user.id) : undefined;
    return this.studyBrowseService.publicKnowledgeTree(id, userId);
  }
}
