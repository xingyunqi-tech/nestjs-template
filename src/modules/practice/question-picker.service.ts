import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { WrongBookReader } from './ports/wrong-book.reader';
import { WeakPointReader } from './ports/weak-point.reader';
import { PracticeMode } from './domain/practice-mode';
import { PracticeScope, PracticeSessionStatus } from './domain/practice-session';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionStatus } from '../questions/domain/question-status';
import { QuestionDrawCriteria, QuestionUnit, mergeUnits, takeLeadingUnits } from '../questions/domain/question-unit';
import { DailyQuestionSetsService } from '../papers/daily-question-sets.service';
import { PapersService } from '../papers/papers.service';

export interface PickRequest {
  userId: number;
  subjectId: string;
  mode: PracticeMode;
  scope: PracticeScope;
  count: number;
  /** DAILY 的业务日期 */
  dailyDate?: string;
}

export interface PickResult {
  questionIds: string[];
  questionVersions: Record<string, number>;
  insufficient: boolean;
}

export interface DailyPickResult extends PickResult {
  /** 选题所依据的题组题目，题组不存在时为空数组 */
  dailySetQuestionIds: string[];
}

const SMART_WEAK_RATIO = 0.6;
const SMART_WRONG_RATIO = 0.2;

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function sizeOf(units: QuestionUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.questions.length, 0);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function toResult(units: QuestionUnit[], insufficient: boolean, versions?: Map<string, number>): PickResult {
  const questions = mergeUnits(units).flatMap((unit) => unit.questions);
  return {
    questionIds: questions.map((question) => question.id),
    questionVersions: Object.fromEntries(
      questions.map((question) => [question.id, versions?.get(question.id) ?? question.currentVersion]),
    ),
    insufficient,
  };
}

/** 按模式出题：以材料为单位，排除进行中模考的题目与下架题（模考除外） */
@Injectable()
export class QuestionPickerService {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly dailyQuestionSetsService: DailyQuestionSetsService,
    private readonly papersService: PapersService,
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly inProgressMockQuestionsService: InProgressMockQuestionsService,
    private readonly wrongBookReader: WrongBookReader,
    private readonly weakPointReader: WeakPointReader,
  ) {}

  async pick(request: PickRequest): Promise<PickResult> {
    switch (request.mode) {
      case PracticeMode.DAILY:
        return this.pickDaily(request.subjectId, request.dailyDate!);
      case PracticeMode.WRONG:
        return this.pickWrong(request);
      case PracticeMode.SMART:
        return this.pickSmart(request);
      case PracticeMode.CHAPTER:
        return this.pickDrawn(request, { knowledgePointIds: [request.scope.knowledgePointId!] }, true);
      case PracticeMode.RANDOM:
        return this.pickDrawn(request, {}, false);
      case PracticeMode.TYPE:
        return this.pickDrawn(request, { type: request.scope.questionType }, false);
      case PracticeMode.MEMORIZE:
        return this.pickDrawn(
          request,
          {
            ...(request.scope.knowledgePointId && { knowledgePointIds: [request.scope.knowledgePointId] }),
            ...(request.scope.questionType && { type: request.scope.questionType }),
          },
          false,
        );
      default:
        throw unprocessable('mode', 'practiceModeNotSupported');
    }
  }

  /** 试卷全部题目，按试卷顺序，版本取试卷记录的版本 */
  async pickFromPaper(paperId: string): Promise<PickResult> {
    const rows = await this.papersService.findQuestions(paperId);
    const units = await this.questionsService.findUnitsByQuestionIds(rows.map((row) => row.questionId));
    return toResult(units, false, new Map(rows.map((row) => [row.questionId, row.questionVersion])));
  }

  private async pickDrawn(
    request: PickRequest,
    criteria: Omit<QuestionDrawCriteria, 'subjectId' | 'excludeRootIds'>,
    preferUnanswered: boolean,
  ): Promise<PickResult> {
    const mockRootIds = await this.findMockRootIds(request.userId);
    const units: QuestionUnit[] = [];
    if (preferUnanswered) {
      const answered = await this.papersService.findAnsweredRootIds(request.userId, request.subjectId);
      await this.drawInto(units, request, criteria, [...mockRootIds, ...answered]);
    }
    await this.drawInto(units, request, criteria, mockRootIds);
    return toResult(units, sizeOf(units) < request.count);
  }

  /** 薄弱知识点、错题、未做题按比例出题，不足部分以未做题补齐，仍不足时放宽为已做题 */
  private async pickSmart(request: PickRequest): Promise<PickResult> {
    const { userId, subjectId, count } = request;
    const [mockRootIds, answered, weakPointIds, wrongIds] = await Promise.all([
      this.findMockRootIds(userId),
      this.papersService.findAnsweredRootIds(userId, subjectId),
      this.weakPointReader.findWeakKnowledgePointIds(userId, subjectId),
      this.wrongBookReader.findActiveQuestionIds(userId, subjectId),
    ]);
    const units: QuestionUnit[] = [];
    if (weakPointIds.length > 0) {
      await this.drawInto(
        units,
        { ...request, count: Math.round(count * SMART_WEAK_RATIO) },
        { knowledgePointIds: weakPointIds },
        mockRootIds,
      );
    }
    if (wrongIds.length > 0) {
      const picked = new Set(units.map((unit) => unit.root.id));
      const wrongUnits = (await this.findAvailableUnits(userId, wrongIds)).filter((unit) => !picked.has(unit.root.id));
      units.push(...takeLeadingUnits(shuffle(wrongUnits), Math.round(count * SMART_WRONG_RATIO)));
    }
    await this.drawInto(units, request, {}, [...mockRootIds, ...answered]);
    await this.drawInto(units, request, {}, mockRootIds);
    return toResult(units, sizeOf(units) < count);
  }

  private async pickWrong(request: PickRequest): Promise<PickResult> {
    const fromSessionId = request.scope.fromSessionId;
    if (!fromSessionId) {
      const ids = await this.wrongBookReader.findActiveQuestionIds(request.userId, request.subjectId);
      const units = takeLeadingUnits(await this.findAvailableUnits(request.userId, ids), request.count);
      return toResult(units, sizeOf(units) < request.count);
    }
    const source = await this.practiceSessionRepository.findById(fromSessionId);
    if (
      source?.userId !== request.userId ||
      source.subjectId !== request.subjectId ||
      (source.mode === PracticeMode.MOCK && source.status !== PracticeSessionStatus.SUBMITTED)
    ) {
      throw unprocessable('scope', 'invalidFromSession');
    }
    const ids = await this.practiceSessionRepository.findWrongQuestionIds(source);
    return toResult(await this.findAvailableUnits(request.userId, ids), false);
  }

  /** 当日题组中已发布的题目 */
  async pickDaily(subjectId: string, dailyDate: string): Promise<DailyPickResult> {
    const set = await this.dailyQuestionSetsService.ensure(subjectId, dailyDate);
    if (!set) {
      return { ...toResult([], false), dailySetQuestionIds: [] };
    }
    const units = await this.questionsService.findUnitsByQuestionIds(set.questionIds);
    return { ...toResult(this.onlyPublished(units), false), dailySetQuestionIds: set.questionIds };
  }

  /** 按传入顺序归组，剔除下架题与进行中模考的题目 */
  private async findAvailableUnits(userId: number, questionIds: string[]): Promise<QuestionUnit[]> {
    if (questionIds.length === 0) {
      return [];
    }
    const inMock = await this.inProgressMockQuestionsService.findQuestionIds(userId);
    const units = await this.questionsService.findUnitsByQuestionIds(questionIds.filter((id) => !inMock.has(id)));
    return this.onlyPublished(units);
  }

  private onlyPublished(units: QuestionUnit[]): QuestionUnit[] {
    return units
      .map((unit) => ({ ...unit, questions: unit.questions.filter((q) => q.status === QuestionStatus.PUBLISHED) }))
      .filter((unit) => unit.root.status === QuestionStatus.PUBLISHED && unit.questions.length > 0);
  }

  private async drawInto(
    units: QuestionUnit[],
    request: PickRequest,
    criteria: Omit<QuestionDrawCriteria, 'subjectId' | 'excludeRootIds'>,
    excludeRootIds: Question['id'][],
  ): Promise<void> {
    const remaining = request.count - sizeOf(units);
    if (remaining <= 0) {
      return;
    }
    const drawn = await this.questionsService.drawUnits(
      {
        ...criteria,
        subjectId: request.subjectId,
        excludeRootIds: [...new Set([...excludeRootIds, ...units.map((unit) => unit.root.id)])],
      },
      remaining,
    );
    units.push(...drawn);
  }

  private async findMockRootIds(userId: number): Promise<string[]> {
    const questionIds = [...(await this.inProgressMockQuestionsService.findQuestionIds(userId))];
    if (questionIds.length === 0) {
      return [];
    }
    const summaries = await this.questionsService.findSummariesByIds(questionIds);
    return [...new Set(summaries.map((summary) => summary.parentId ?? summary.id))];
  }
}
