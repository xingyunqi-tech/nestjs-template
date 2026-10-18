import { ApiProperty } from '@nestjs/swagger';

export class WrongBookSubjectCountDto {
  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: Number })
  activeCount: number;
}

export class WrongBookKnowledgePointCountDto {
  @ApiProperty({ type: String, format: 'uuid' })
  knowledgePointId: string;

  @ApiProperty({ type: Number, description: '知识点子树内的 ACTIVE 错题数' })
  activeCount: number;
}

export class WrongBookSummaryDto {
  @ApiProperty({ type: Number, description: 'ACTIVE 错题总数' })
  activeCount: number;

  @ApiProperty({ type: Number, description: '本周首次进入错题本的数量（Asia/Shanghai，周一起算）' })
  weeklyAdded: number;

  @ApiProperty({ type: Number, description: '当前已掌握且本周掌握的数量' })
  weeklyMastered: number;

  @ApiProperty({ type: Date, description: '本周起始时间' })
  weekStart: Date;

  @ApiProperty({ type: () => [WrongBookSubjectCountDto] })
  bySubject: WrongBookSubjectCountDto[];

  @ApiProperty({ type: () => [WrongBookKnowledgePointCountDto] })
  byKnowledgePoint: WrongBookKnowledgePointCountDto[];
}
