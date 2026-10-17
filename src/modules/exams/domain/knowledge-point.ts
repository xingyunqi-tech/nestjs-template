import { ApiProperty } from '@nestjs/swagger';

export class KnowledgePoint {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty({ type: String, example: '言语理解与表达' })
  name: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 3 })
  level: number;

  @ApiProperty({ type: Number, example: 0 })
  sort: number;

  @ApiProperty({ type: String, description: '物化路径：自根节点起各级 ID，以 / 分隔并首尾带 /' })
  path: string;

  @ApiProperty({ type: Boolean })
  isLeaf: boolean;

  @ApiProperty({ type: Number, description: '已发布题目数' })
  questionCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
