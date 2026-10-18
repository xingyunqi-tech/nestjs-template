export const QUESTION_NOTE_MAX_LENGTH = 1000;

export class QuestionNote {
  id: string;
  userId: number;
  questionId: string;
  subjectId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}
