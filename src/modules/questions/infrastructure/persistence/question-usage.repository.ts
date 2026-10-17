import { Question } from '../../domain/question';

/** 题目被作答记录或试卷引用的情况 */
export abstract class QuestionUsageRepository {
  abstract isUsed(questionIds: Question['id'][]): Promise<boolean>;
}
