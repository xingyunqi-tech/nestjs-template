import { Injectable } from '@nestjs/common';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { QuestionAssociationReader } from './ports/question-association.reader';
import { HiddenReason } from './domain/hidden-reason';
import { QuestionContentDto } from './dto/question-content.dto';
import { QuestionsService } from '../questions/questions.service';
import { QuestionType } from '../questions/domain/question-type';
import { BusinessException } from '../../common/exceptions/business.exception';

/** 用户按 id 获取题目：须与会话、错题本、收藏或笔记存在关联 */
@Injectable()
export class QuestionAccessService {
  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly questionAssociationReader: QuestionAssociationReader,
    private readonly inProgressMockQuestionsService: InProgressMockQuestionsService,
    private readonly questionsService: QuestionsService,
  ) {}

  async getQuestion(userId: number, questionId: string): Promise<QuestionContentDto> {
    const [question] = await this.questionsService.findByIds([questionId]);
    if (!question) {
      throw new BusinessException('questionNotAccessible');
    }
    const [unit] =
      question.type === QuestionType.MATERIAL
        ? await this.questionsService.findUnits([question.id])
        : await this.questionsService.findUnitsByQuestionIds([question.id]);
    const candidateIds = unit?.questions.map((item) => item.id) ?? [];
    const inSessions = new Set(
      await this.practiceSessionRepository.findQuestionIdsInUserSessions(userId, candidateIds),
    );
    const rest = candidateIds.filter((id) => !inSessions.has(id));
    const associated = new Set(
      rest.length > 0 ? await this.questionAssociationReader.findAssociatedQuestionIds(userId, rest) : [],
    );
    const related = unit?.questions.filter((item) => inSessions.has(item.id) || associated.has(item.id)) ?? [];
    if (related.length === 0) {
      throw new BusinessException('questionNotAccessible');
    }
    const [dto] = await this.questionsService.toPublicUnits([{ root: unit.root, questions: related }], userId);
    const inMock = await this.inProgressMockQuestionsService.findQuestionIds(userId);
    return Object.assign(new QuestionContentDto(), dto, {
      hiddenReason: related.some((item) => inMock.has(item.id)) ? HiddenReason.MOCK_IN_PROGRESS : null,
    });
  }
}
