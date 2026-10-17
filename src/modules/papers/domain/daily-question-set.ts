import { ApiProperty } from '@nestjs/swagger';

export class DailyQuestionSet {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-17' })
  date: string;

  @ApiProperty({ type: String, format: 'uuid', isArray: true, description: '可作答题目，材料小题连续排列' })
  questionIds: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
