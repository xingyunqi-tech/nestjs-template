import { ApiPropertyOptional } from '@nestjs/swagger';
import { Question } from '../domain/question';

export class AdminQuestionDto extends Question {
  @ApiPropertyOptional({ type: () => [AdminQuestionDto], description: '材料题的小题，按顺序' })
  children?: AdminQuestionDto[];
}
