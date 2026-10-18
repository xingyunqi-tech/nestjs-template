import { ApiProperty } from '@nestjs/swagger';
import { Question } from '../domain/question';
import { QuestionAnswer } from '../domain/question-answer';

/** 答案与解析；主观题的答案为参考答案与要点 */
export class QuestionSolutionDto {
  @ApiProperty({ type: Object, nullable: true, example: { keys: ['B'] } })
  answer: QuestionAnswer | null;

  @ApiProperty({ type: String, nullable: true })
  analysis: string | null;
}

/** 答案与解析均取题目当前版本，analysis 为已解析文件引用的当前解析 */
export function toQuestionSolution(question: Question, analysis: string | null): QuestionSolutionDto {
  const dto = new QuestionSolutionDto();
  if (question.answer && 'rubricId' in question.answer) {
    const { rubricId: _rubricId, ...answer } = question.answer;
    dto.answer = answer;
  } else {
    dto.answer = question.answer;
  }
  dto.analysis = analysis;
  return dto;
}
