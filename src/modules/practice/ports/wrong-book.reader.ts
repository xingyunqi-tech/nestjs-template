import { Injectable } from '@nestjs/common';

export abstract class WrongBookReader {
  /** 科目内错题本 ACTIVE 的题目 */
  abstract findActiveQuestionIds(userId: number, subjectId: string): Promise<string[]>;
}

@Injectable()
export class EmptyWrongBookReader implements WrongBookReader {
  findActiveQuestionIds(_userId: number, _subjectId: string): Promise<string[]> {
    return Promise.resolve([]);
  }
}
