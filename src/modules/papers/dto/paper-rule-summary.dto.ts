import { ApiProperty } from '@nestjs/swagger';

export class PaperRuleSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Number })
  durationMin: number;

  @ApiProperty({ type: Number, description: '目标题量，材料题以材料为单位抽取时实际题量可能更多' })
  questionCount: number;

  @ApiProperty({ type: Number, description: '按目标题量计算的总分' })
  totalScore: number;
}
