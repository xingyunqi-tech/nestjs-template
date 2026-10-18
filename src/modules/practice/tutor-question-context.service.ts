import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { AnswerVisibilityService } from './answer-visibility.service';
import { revealedBySession } from './domain/answer-visibility';
import { AnswerRecord } from './domain/answer-record';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { BusinessException } from '../../common/exceptions/business.exception';

export interface TutorQuestionContext {
  question: Question;
  /** 小题所属材料 */
  material: Question | null;
  /** 用于讲解的作答：带会话时取该会话的作答，否则取最近一次已可见的作答 */
  record: Pick<AnswerRecord, 'answer' | 'isCorrect'> | null;
}

/** AI 讲题的题目、材料与作答，按答案可见性判定 */
@Injectable()
export class TutorQuestionContextService {
  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly answerVisibilityService: AnswerVisibilityService,
    private readonly questionsService: QuestionsService,
  ) {}

  /**
   * @throws BusinessException questionNotAccessible（题目不存在、为材料或不属于该会话）、answerHidden
   * @throws NotFoundException practiceSessionNotFound
   */
  async resolve(userId: number, questionId: string, sessionId: string | null): Promise<TutorQuestionContext> {
    const [question] = isUUID(questionId) ? await this.questionsService.findByIds([questionId.toLowerCase()]) : [];
    if (!question || question.type === QuestionType.MATERIAL) {
      throw new BusinessException('questionNotAccessible');
    }
    const record = sessionId
      ? await this.resolveInSession(userId, question, sessionId)
      : await this.resolveStandalone(userId, question);
    const [material] = question.parentId ? await this.questionsService.findByIds([question.parentId]) : [];
    return { question, material: material ?? null, record };
  }

  private async resolveInSession(
    userId: number,
    question: Question,
    sessionId: string,
  ): Promise<TutorQuestionContext['record']> {
    const session = isUUID(sessionId) ? await this.practiceSessionRepository.findById(sessionId.toLowerCase()) : null;
    if (session?.userId !== userId) {
      throw new NotFoundException({ error: 'practiceSessionNotFound' });
    }
    if (!session.questionIds.includes(question.id)) {
      throw new BusinessException('questionNotAccessible');
    }
    const [record] = await this.practiceSessionRepository.findRecords(session.id, [question.id]);
    await this.answerVisibilityService.assertVisible(
      userId,
      { questionId: question.id, questionType: question.type, session, record },
      'session',
    );
    return record ? { answer: record.answer, isCorrect: record.isCorrect } : null;
  }

  private async resolveStandalone(userId: number, question: Question): Promise<TutorQuestionContext['record']> {
    await this.answerVisibilityService.assertVisible(
      userId,
      { questionId: question.id, questionType: question.type },
      'standalone',
    );
    const contexts = await this.practiceSessionRepository.findSessionAnswerContexts(userId, question.id);
    const latest = contexts.find(
      (context) =>
        (context.record?.answer ?? null) !== null && revealedBySession({ questionType: question.type, ...context }),
    )?.record;
    return latest ? { answer: latest.answer, isCorrect: latest.isCorrect } : null;
  }
}
