import { Injectable } from '@nestjs/common';

export abstract class QuestionAssociationReader {
  /** questionIds 中位于用户错题本、收藏或笔记的题目 */
  abstract findAssociatedQuestionIds(userId: number, questionIds: string[]): Promise<string[]>;
}

@Injectable()
export class EmptyQuestionAssociationReader implements QuestionAssociationReader {
  findAssociatedQuestionIds(_userId: number, _questionIds: string[]): Promise<string[]> {
    return Promise.resolve([]);
  }
}
