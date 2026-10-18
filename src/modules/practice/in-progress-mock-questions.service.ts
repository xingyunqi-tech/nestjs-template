import { Injectable } from '@nestjs/common';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';

@Injectable()
export class InProgressMockQuestionsService {
  constructor(private readonly practiceSessionRepository: PracticeSessionRepository) {}

  /** 用户进行中模考的题目集合 */
  async findQuestionIds(userId: number): Promise<ReadonlySet<string>> {
    return new Set(await this.practiceSessionRepository.findInProgressMockQuestionIds(userId));
  }
}
