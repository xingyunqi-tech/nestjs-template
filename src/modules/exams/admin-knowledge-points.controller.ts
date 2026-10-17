import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { KnowledgePointsService } from './knowledge-points.service';
import { KnowledgePoint } from './domain/knowledge-point';
import { CreateKnowledgePointDto } from './dto/create-knowledge-point.dto';
import { UpdateKnowledgePointDto } from './dto/update-knowledge-point.dto';
import { MoveKnowledgePointDto } from './dto/move-knowledge-point.dto';
import {
  MigrateKnowledgePointQuestionsDto,
  MigrateKnowledgePointQuestionsResultDto,
} from './dto/migrate-knowledge-point-questions.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Admin Knowledge Points')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/knowledge-points', version: '1' })
export class AdminKnowledgePointsController {
  constructor(private readonly knowledgePointsService: KnowledgePointsService) {}

  @ApiOperation({ operationId: 'adminCreateKnowledgePoint', summary: '新增知识点' })
  @ApiOkResponse({ type: KnowledgePoint })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateKnowledgePointDto): Promise<KnowledgePoint> {
    return this.knowledgePointsService.create(dto);
  }

  @ApiOperation({ operationId: 'adminUpdateKnowledgePoint', summary: '修改知识点名称或排序' })
  @ApiOkResponse({ type: KnowledgePoint })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateKnowledgePointDto): Promise<KnowledgePoint> {
    return this.knowledgePointsService.update(id, dto);
  }

  @ApiOperation({ operationId: 'adminDeleteKnowledgePoint', summary: '删除知识点（无子节点且无关联题目）' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.knowledgePointsService.remove(id);
  }

  @ApiOperation({ operationId: 'adminMoveKnowledgePoint', summary: '移动知识点' })
  @ApiOkResponse({ type: KnowledgePoint })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(@Param('id', ParseUuidPipe) id: string, @Body() dto: MoveKnowledgePointDto): Promise<KnowledgePoint> {
    return this.knowledgePointsService.move(id, dto);
  }

  @ApiOperation({ operationId: 'adminMigrateKnowledgePointQuestions', summary: '把知识点的题目迁移到另一叶子知识点' })
  @ApiOkResponse({ type: MigrateKnowledgePointQuestionsResultDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post(':id/migrate-questions')
  @HttpCode(HttpStatus.OK)
  migrateQuestions(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: MigrateKnowledgePointQuestionsDto,
  ): Promise<MigrateKnowledgePointQuestionsResultDto> {
    return this.knowledgePointsService.migrateQuestions(id, dto);
  }
}
