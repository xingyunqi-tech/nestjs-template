import { Injectable } from '@nestjs/common';
import { QuestionUsageRepository } from '../../question-usage.repository';
import { Question } from '../../../../domain/question';

/** 空实现：所有题目均视为未被使用 */
@Injectable()
export class UnusedQuestionUsageRepository implements QuestionUsageRepository {
  isUsed(_questionIds: Question['id'][]): Promise<boolean> {
    return Promise.resolve(false);
  }
}
