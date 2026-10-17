import { ApiProperty } from '@nestjs/swagger';
import { QuestionType } from '../../questions/domain/question-type';

export class PaperSection {
  @ApiProperty({ type: String, example: '常识判断' })
  title: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  questionType: QuestionType;
}
