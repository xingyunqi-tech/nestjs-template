import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { DailyQuestionSetRepository } from './infrastructure/persistence/daily-question-set.repository';
import { DailySetUsageRepository } from './infrastructure/persistence/daily-set-usage.repository';
import { DailyQuestionSet } from './domain/daily-question-set';
import { businessDate, daysBetween } from './domain/business-date';
import { DailySummaryDto, DailyTrialDto, TrialCheckDto, TrialCheckResultDto } from './dto/daily.dto';
import { SubjectsService } from '../exams/subjects.service';
import { QuestionsService } from '../questions/questions.service';
import { QuestionUnit, takeLeadingUnits } from '../questions/domain/question-unit';
import { gradeObjective } from '../questions/domain/objective-grading';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const DEFAULT_DAILY_SET_SIZE = 10;
const DEFAULT_TRIAL_SIZE = 3;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isValidDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

@Injectable()
export class DailyQuestionSetsService {
  private readonly logger = new Logger(DailyQuestionSetsService.name);

  constructor(
    private readonly dailyQuestionSetRepository: DailyQuestionSetRepository,
    private readonly dailySetUsageRepository: DailySetUsageRepository,
    private readonly subjectsService: SubjectsService,
    private readonly questionsService: QuestionsService,
    private readonly appConfigService: AppConfigService,
  ) {}

  /** 返回新生成或已存在的题组数 */
  async generateForPublishedSubjects(date: string = businessDate()): Promise<number> {
    let count = 0;
    for (const subject of await this.subjectsService.findAllPublished()) {
      try {
        if (await this.ensure(subject.id, date)) {
          count += 1;
        }
      } catch (error) {
        this.logger.error(
          `Failed to generate daily set for subject ${subject.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return count;
  }

  /** 题组不存在时生成；并发生成以唯一键去重；题库为空时不生成并返回 null */
  async ensure(subjectId: string, date: string): Promise<DailyQuestionSet | null> {
    const existing = await this.dailyQuestionSetRepository.findOne(subjectId, date);
    if (existing) {
      return existing;
    }
    const questionIds = await this.drawQuestionIds(subjectId);
    if (questionIds.length === 0) {
      return null;
    }
    return this.dailyQuestionSetRepository.insertIfAbsent(subjectId, date, questionIds);
  }

  async getSummary(subjectId: string): Promise<DailySummaryDto> {
    const { date, set } = await this.today(subjectId);
    return { subjectId, date, questionCount: set?.questionIds.length ?? 0, completion: null };
  }

  async getTrial(subjectId: string): Promise<DailyTrialDto> {
    const { date, units } = await this.trialUnits(subjectId);
    return {
      subjectId,
      date,
      questionCount: units.reduce((sum, unit) => sum + unit.questions.length, 0),
      questions: await this.questionsService.toPublicUnits(units, null),
    };
  }

  /** 按题目最新答案判分，不落库 */
  async checkTrial(subjectId: string, dto: TrialCheckDto): Promise<TrialCheckResultDto> {
    const today = businessDate();
    const yesterday = businessDate(new Date(Date.now() - DAY_MS));
    if (dto.date !== today && dto.date !== yesterday) {
      throw unprocessable('date', 'invalidTrialDate');
    }
    const { units } = await this.trialUnits(subjectId, dto.date);
    const questions = new Map(units.flatMap((unit) => unit.questions).map((question) => [question.id, question]));
    if (dto.answers.some((item) => !questions.has(item.questionId))) {
      throw unprocessable('answers', 'questionNotInTrial');
    }
    return {
      results: dto.answers.map((item) => {
        const question = questions.get(item.questionId)!;
        return { questionId: item.questionId, isCorrect: gradeObjective(question.type, question.answer, item.answer) };
      }),
    };
  }

  async findRange(subjectId: string, from: string, to: string): Promise<DailyQuestionSet[]> {
    await this.subjectsService.findById(subjectId);
    if (!isValidDate(from) || !isValidDate(to)) {
      throw unprocessable('from', 'invalidDate');
    }
    const days = daysBetween(from, to);
    if (days < 0 || days >= MAX_RANGE_DAYS) {
      throw unprocessable('to', 'invalidDateRange');
    }
    return this.dailyQuestionSetRepository.findRange(subjectId, from, to);
  }

  /** 当日及以后的题组可重新生成；已有用户会话时拒绝 */
  async regenerate(subjectId: string, date: string): Promise<DailyQuestionSet> {
    await this.subjectsService.findById(subjectId);
    if (!isValidDate(date)) {
      throw unprocessable('date', 'invalidDate');
    }
    if (date < businessDate()) {
      throw unprocessable('date', 'dailySetDateInPast');
    }
    if (await this.dailySetUsageRepository.hasSessions(subjectId, date)) {
      throw new ConflictException({ error: 'dailySetInUse' });
    }
    const questionIds = await this.drawQuestionIds(subjectId);
    if (questionIds.length === 0) {
      throw new BusinessException('noQuestionsAvailable');
    }
    return this.dailyQuestionSetRepository.upsert(subjectId, date, questionIds);
  }

  private async today(subjectId: string): Promise<{ date: string; set: DailyQuestionSet | null }> {
    await this.subjectsService.getPublishedSubject(subjectId);
    const date = businessDate();
    return { date, set: await this.ensure(subjectId, date) };
  }

  private async trialUnits(
    subjectId: string,
    date: string = businessDate(),
  ): Promise<{ date: string; units: QuestionUnit[] }> {
    await this.subjectsService.getPublishedSubject(subjectId);
    const set =
      date === businessDate()
        ? await this.ensure(subjectId, date)
        : await this.dailyQuestionSetRepository.findOne(subjectId, date);
    if (!set) {
      return { date, units: [] };
    }
    const size = positiveInteger(await this.appConfigService.getValue('practice.trialSize'), DEFAULT_TRIAL_SIZE);
    const units = await this.questionsService.findUnitsByQuestionIds(set.questionIds);
    return { date, units: takeLeadingUnits(units, size) };
  }

  private async drawQuestionIds(subjectId: string): Promise<string[]> {
    const size = positiveInteger(await this.appConfigService.getValue('practice.dailySetSize'), DEFAULT_DAILY_SET_SIZE);
    const units = await this.questionsService.drawUnits({ subjectId }, size);
    return units.flatMap((unit) => unit.questions.map((question) => question.id));
  }
}
