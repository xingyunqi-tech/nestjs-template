import { ApiProperty } from '@nestjs/swagger';
import { QuestionNote } from '../domain/question-note';
import { PublicQuestionUnitDto } from '../../questions/dto/public-question.dto';

export class QuestionNoteDto {
  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String })
  content: string;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class QuestionNoteItemDto extends QuestionNoteDto {
  @ApiProperty({
    type: () => PublicQuestionUnitDto,
    nullable: true,
    description: '题目摘要，不含答案与解析；材料小题为材料连同该小题',
  })
  question: PublicQuestionUnitDto | null;
}

export function toQuestionNoteDto(note: QuestionNote): QuestionNoteDto {
  return Object.assign(new QuestionNoteDto(), {
    questionId: note.questionId,
    subjectId: note.subjectId,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });
}
