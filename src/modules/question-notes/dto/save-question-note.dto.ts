import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { QUESTION_NOTE_MAX_LENGTH } from '../domain/question-note';

export class SaveQuestionNoteDto {
  @ApiProperty({ type: String, maxLength: QUESTION_NOTE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUESTION_NOTE_MAX_LENGTH)
  @Matches(/\S/, { message: 'noteContentBlank' })
  content: string;
}
