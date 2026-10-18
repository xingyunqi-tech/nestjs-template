import { ApiProperty } from '@nestjs/swagger';

export class GeneratedPaperDto {
  @ApiProperty({ type: String, format: 'uuid', description: '仅本人可见，以模拟考试方式开考' })
  paperId: string;

  @ApiProperty({ type: Number, description: '可作答题数' })
  questionCount: number;

  @ApiProperty({ type: Boolean, description: '存在题量不足的规则项' })
  insufficient: boolean;
}
