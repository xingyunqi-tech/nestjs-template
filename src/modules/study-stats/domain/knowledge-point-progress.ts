export interface KnowledgePointProgress {
  answeredQuestionCount: number;
  questionCount: number;
  answered: number;
  correct: number;
  mastery: number | null;
}

export interface WeakPoint {
  knowledgePointId: string;
  answered: number;
  correct: number;
  mastery: number;
}
