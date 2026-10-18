import { Injectable } from '@nestjs/common';

export abstract class WeakPointReader {
  /** 科目内的薄弱叶子知识点，按薄弱程度排序 */
  abstract findWeakKnowledgePointIds(userId: number, subjectId: string): Promise<string[]>;
}

@Injectable()
export class EmptyWeakPointReader implements WeakPointReader {
  findWeakKnowledgePointIds(_userId: number, _subjectId: string): Promise<string[]> {
    return Promise.resolve([]);
  }
}
