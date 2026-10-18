import { Inject, Injectable } from '@nestjs/common';

export abstract class QuestionAssociationReader {
  /** questionIds 中位于用户错题本、收藏或笔记的题目 */
  abstract findAssociatedQuestionIds(userId: number, questionIds: string[]): Promise<string[]>;
}

/** 单一来源（错题本、收藏、笔记）的题目关联 */
export interface QuestionAssociationSource {
  findAssociatedQuestionIds(userId: number, questionIds: string[]): Promise<string[]>;
}

export const QUESTION_ASSOCIATION_SOURCES = Symbol('QUESTION_ASSOCIATION_SOURCES');

@Injectable()
export class CompositeQuestionAssociationReader implements QuestionAssociationReader {
  constructor(@Inject(QUESTION_ASSOCIATION_SOURCES) private readonly sources: QuestionAssociationSource[]) {}

  async findAssociatedQuestionIds(userId: number, questionIds: string[]): Promise<string[]> {
    const found = new Set<string>();
    let rest = [...new Set(questionIds)];
    for (const source of this.sources) {
      if (rest.length === 0) {
        break;
      }
      (await source.findAssociatedQuestionIds(userId, rest)).forEach((id) => found.add(id));
      rest = rest.filter((id) => !found.has(id));
    }
    return [...new Set(questionIds)].filter((id) => found.has(id));
  }
}
