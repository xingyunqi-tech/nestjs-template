export interface QuestionOption {
  key: string;
  content: string;
}

export interface ChoiceAnswer {
  keys: string[];
}

export interface JudgeAnswer {
  value: boolean;
}

export interface FillAnswer {
  blanks: string[][];
}

export interface ShortAnswer {
  reference: string;
  points: string[];
  rubricId?: string;
}

export interface EssayAnswer {
  reference?: string;
  rubricId?: string;
}

export type QuestionAnswer = ChoiceAnswer | JudgeAnswer | FillAnswer | ShortAnswer | EssayAnswer;
