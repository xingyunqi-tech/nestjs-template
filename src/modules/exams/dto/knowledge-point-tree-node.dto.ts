import { ApiProperty } from '@nestjs/swagger';
import { KnowledgePoint } from '../domain/knowledge-point';

export class KnowledgePointTreeNodeDto extends KnowledgePoint {
  @ApiProperty({ type: () => [KnowledgePointTreeNodeDto] })
  children: KnowledgePointTreeNodeDto[];
}

export class KnowledgePointProgressDto {
  @ApiProperty({ type: Number, description: '子树内已做题数（按题去重）' })
  answeredQuestionCount: number;

  @ApiProperty({ type: Number, description: '子树内已发布题目数（按题去重）' })
  questionCount: number;

  @ApiProperty({ type: Number, description: '子树内已计入统计的作答次数（按作答记录去重）' })
  answered: number;

  @ApiProperty({ type: Number })
  correct: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '掌握度（百分制，两位小数）：最近 20 次正确率 × 0.7 + 累计正确率 × 0.3；作答不足 5 次为 null（数据不足）',
  })
  mastery: number | null;
}

export class PublicKnowledgePointTreeNodeDto extends KnowledgePoint {
  @ApiProperty({ type: () => [PublicKnowledgePointTreeNodeDto] })
  children: PublicKnowledgePointTreeNodeDto[];

  @ApiProperty({
    type: () => KnowledgePointProgressDto,
    nullable: true,
    description: '登录用户的个人进度，未登录时为 null',
  })
  progress: KnowledgePointProgressDto | null;
}
