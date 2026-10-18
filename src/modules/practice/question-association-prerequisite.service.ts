import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { revealedBySession } from './domain/answer-visibility';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { BusinessException } from '../../common/exceptions/business.exception';

/** 收藏、笔记建立关联的前提：可作答题目不在进行中的模考，且在用户某个会话中已满足可见性规则 1-3 */
@Injectable()
export class QuestionAssociationPrerequisiteService {
  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly inProgressMockQuestionsService: InProgressMockQuestionsService,
    private readonly questionsService: QuestionsService,
  ) {}

  async assertEligible(userId: number, questionId: string): Promise<Question> {
    const [question] = isUUID(questionId) ? await this.questionsService.findByIds([questionId.toLowerCase()]) : [];
    if (!question || question.type === QuestionType.MATERIAL) {
      throw new BusinessException('questionNotAccessible');
    }
    const inMock = await this.inProgressMockQuestionsService.findQuestionIds(userId);
    if (inMock.has(question.id)) {
      throw new BusinessException('questionNotAccessible');
    }
    const contexts = await this.practiceSessionRepository.findSessionAnswerContexts(userId, question.id);
    if (!contexts.some((context) => revealedBySession({ questionType: question.type, ...context }))) {
      throw new BusinessException('questionNotAccessible');
    }
    return question;
  }
}
