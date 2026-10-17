import { ApiProperty } from '@nestjs/swagger';
import { ContentStatus } from './content-status';
import { ExamCategory } from './exam-category';

export class Exam {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, example: '国考' })
  name: string;

  @ApiProperty({ enum: ExamCategory, enumName: 'ExamCategory' })
  category: ExamCategory;

  @ApiProperty({ type: String, nullable: true })
  icon: string | null;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: Number, example: 0 })
  sort: number;

  @ApiProperty({ enum: ContentStatus, enumName: 'ContentStatus' })
  status: ContentStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
