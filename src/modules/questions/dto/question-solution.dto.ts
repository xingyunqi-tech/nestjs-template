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

/** 答案取题目最新版本，解析取渲染的版本 */
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
