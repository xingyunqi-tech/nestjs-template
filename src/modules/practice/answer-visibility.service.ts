import { Injectable } from '@nestjs/common';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { QuestionAssociationReader } from './ports/question-association.reader';
import { HiddenReason } from './domain/hidden-reason';
import { SessionAnswerContext, revealedBySession } from './domain/answer-visibility';
import { BusinessException } from '../../common/exceptions/business.exception';

export interface VisibilityItem extends SessionAnswerContext {
  questionId: string;
}

/** session：练习会话内，只按规则 1-3；standalone：会话外查看题目，另按规则 4 */
export type VisibilityContext = 'session' | 'standalone';

export interface Visibility {
  visible: boolean;
  hiddenReason: HiddenReason | null;
}

const HIDDEN_BY_MOCK: Visibility = { visible: false, hiddenReason: HiddenReason.MOCK_IN_PROGRESS };

/** 前提：题目不在用户进行中的模考；满足前提后按规则判定是否返回答案、解析与判分结果 */
@Injectable()
export class AnswerVisibilityService {
  constructor(
    private readonly inProgressMockQuestionsService: InProgressMockQuestionsService,
    private readonly questionAssociationReader: QuestionAssociationReader,
  ) {}

  /** 按传入顺序返回 */
  async evaluate(userId: number, items: VisibilityItem[], context: VisibilityContext): Promise<Visibility[]> {
    if (items.length === 0) {
      return [];
    }
    const inMock = await this.inProgressMockQuestionsService.findQuestionIds(userId);
    const results: (Visibility | null)[] = items.map((item) => {
      if (inMock.has(item.questionId)) {
        return HIDDEN_BY_MOCK;
      }
      return revealedBySession(item) ? { visible: true, hiddenReason: null } : null;
    });
    if (context === 'session') {
      return results.map((result) => result ?? { visible: false, hiddenReason: null });
    }
    const pending = [...new Set(items.filter((_, index) => results[index] === null).map((item) => item.questionId))];
    const associated = new Set(
      pending.length > 0 ? await this.questionAssociationReader.findAssociatedQuestionIds(userId, pending) : [],
    );
    return results.map(
      (result, index) => result ?? { visible: associated.has(items[index].questionId), hiddenReason: null },
    );
  }

  async check(userId: number, item: VisibilityItem, context: VisibilityContext): Promise<Visibility> {
    const [result] = await this.evaluate(userId, [item], context);
    return result;
  }

  async assertVisible(userId: number, item: VisibilityItem, context: VisibilityContext): Promise<void> {
    const result = await this.check(userId, item, context);
    if (!result.visible) {
      throw new BusinessException(
        'answerHidden',
        result.hiddenReason ? { hiddenReason: result.hiddenReason } : undefined,
      );
    }
  }

  async findInProgressMockQuestionIds(userId: number): Promise<ReadonlySet<string>> {
    return this.inProgressMockQuestionsService.findQuestionIds(userId);
  }
}
