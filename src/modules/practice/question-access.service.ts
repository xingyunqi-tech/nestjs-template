import { Injectable } from '@nestjs/common';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { QuestionAssociationReader } from './ports/question-association.reader';
import { AnswerVisibilityService } from './answer-visibility.service';
import { QuestionContentDto, QuestionContentItemDto } from './dto/question-content.dto';
import { QuestionsService } from '../questions/questions.service';
import { QuestionType } from '../questions/domain/question-type';
import { PublicQuestionDto } from '../questions/dto/public-question.dto';
import { Question } from '../questions/domain/question';
import { QuestionUnit } from '../questions/domain/question-unit';
import { BusinessException } from '../../common/exceptions/business.exception';

/** 用户按 id 获取题目：须与会话、错题本、收藏或笔记存在关联；答案按会话外可见性判定 */
@Injectable()
export class QuestionAccessService {
  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly questionAssociationReader: QuestionAssociationReader,
    private readonly answerVisibilityService: AnswerVisibilityService,
    private readonly questionsService: QuestionsService,
  ) {}

  async getQuestion(userId: number, questionId: string): Promise<QuestionContentDto> {
    const { unit, related } = await this.findRelated(userId, questionId);
    const visibility = await this.answerVisibilityService.evaluate(
      userId,
      related.map((item) => ({ questionId: item.id, questionType: item.type })),
      'standalone',
    );
    const {
      units: [dto],
      solutions,
    } = await this.questionsService.renderUnits([{ root: unit.root, questions: related }], userId, {
      solutionIds: new Set(related.filter((_, index) => visibility[index].visible).map((item) => item.id)),
    });
    const withSolution = (item: PublicQuestionDto): QuestionContentItemDto =>
      Object.assign(new QuestionContentItemDto(), item, { solution: solutions.get(item.id) ?? null });
    const { children, ...root } = dto;
    return Object.assign(new QuestionContentDto(), withSolution(root), {
      ...(children && { children: children.map(withSolution) }),
      hiddenReason: visibility.find((item) => item.hiddenReason !== null)?.hiddenReason ?? null,
    });
  }

  /** 校验用户与题目（材料按其小题）存在关联，返回该题 */
  async assertAccessible(userId: number, questionId: string): Promise<Question> {
    return (await this.findRelated(userId, questionId)).question;
  }

  private async findRelated(
    userId: number,
    questionId: string,
  ): Promise<{ question: Question; unit: QuestionUnit; related: Question[] }> {
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
    return { question, unit, related };
  }
}
