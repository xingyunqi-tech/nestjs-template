import { ApiProperty } from '@nestjs/swagger';
import { Exam } from '../domain/exam';
import { ExamCategory } from '../domain/exam-category';

export class ExamGroupDto {
  @ApiProperty({ enum: ExamCategory, enumName: 'ExamCategory' })
  category: ExamCategory;

  @ApiProperty({ type: () => [Exam] })
  exams: Exam[];
}
