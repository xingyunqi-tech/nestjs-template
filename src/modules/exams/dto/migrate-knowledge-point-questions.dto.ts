import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { KnowledgePoint } from '../domain/knowledge-point';

export class MigrateKnowledgePointQuestionsDto {
  @ApiProperty({ type: String, format: 'uuid', description: '目标叶子知识点' })
  @IsUUID()
  targetId: string;
}

export class MigrateKnowledgePointQuestionsResultDto {
  @ApiProperty({ type: Number, description: '迁移的题目数' })
  migrated: number;

  @ApiProperty({ type: () => KnowledgePoint })
  source: KnowledgePoint;

  @ApiProperty({ type: () => KnowledgePoint })
  target: KnowledgePoint;
}
