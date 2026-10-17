import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exam } from './exam';

export class UserExamProfile {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: Number })
  userId: number;

  @ApiProperty({ type: String, format: 'uuid' })
  examId: string;

  @ApiProperty({ type: Boolean })
  isCurrent: boolean;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-29' })
  examDate: string | null;

  @ApiProperty({ type: Number, example: 30 })
  dailyGoal: number;

  @ApiPropertyOptional({ type: () => Exam })
  exam?: Exam;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
