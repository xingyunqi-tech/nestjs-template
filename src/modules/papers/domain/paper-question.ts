import { ApiProperty } from '@nestjs/swagger';

/** 试卷中的一道可作答题目；材料题按小题各占一行 */
export class PaperQuestion {
  @ApiProperty({ type: String, format: 'uuid' })
  paperId: string;

  @ApiProperty({ type: Number })
  sectionIndex: number;

  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: Number })
  questionVersion: number;

  @ApiProperty({ type: Number })
  sort: number;

  @ApiProperty({ type: Number })
  score: number;
}
