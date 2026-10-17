import { ApiProperty } from '@nestjs/swagger';
import { KnowledgePoint } from '../domain/knowledge-point';

export class KnowledgePointTreeNodeDto extends KnowledgePoint {
  @ApiProperty({ type: () => [KnowledgePointTreeNodeDto] })
  children: KnowledgePointTreeNodeDto[];
}

export class PublicKnowledgePointTreeNodeDto extends KnowledgePoint {
  @ApiProperty({ type: () => [PublicKnowledgePointTreeNodeDto] })
  children: PublicKnowledgePointTreeNodeDto[];

  @ApiProperty({ type: Object, nullable: true, description: '登录用户的个人进度，暂未提供时为 null' })
  progress: Record<string, unknown> | null;
}
