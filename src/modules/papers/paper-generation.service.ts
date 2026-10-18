import { Injectable, NotFoundException } from '@nestjs/common';
import { PaperRepository } from './infrastructure/persistence/paper.repository';
import { PaperRuleRepository } from './infrastructure/persistence/paper-rule.repository';
import { PaperAttemptRepository } from './infrastructure/persistence/paper-attempt.repository';
import { PaperRulesService } from './paper-rules.service';
import { PaperType } from './domain/paper-type';
import { businessDayStart } from './domain/business-date';
import { GeneratedPaperDto } from './dto/generated-paper.dto';
import { ContentStatus } from '../exams/domain/content-status';
import { SubjectsService } from '../exams/subjects.service';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const DEFAULT_DAILY_LIMIT = 5;
const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

function ruleNotFound(): NotFoundException {
  return new NotFoundException({ error: 'paperRuleNotFound' });
}

/** 用户按组卷规则生成个人试卷 */
@Injectable()
export class PaperGenerationService {
  constructor(
    private readonly paperRepository: PaperRepository,
    private readonly paperRuleRepository: PaperRuleRepository,
    private readonly paperAttemptRepository: PaperAttemptRepository,
    private readonly paperRulesService: PaperRulesService,
    private readonly subjectsService: SubjectsService,
    private readonly appConfigService: AppConfigService,
  ) {}

  /** 优先排除近 30 天作答过的题目；每用户每日生成次数受远程配置限制 */
  async generate(ruleId: string, userId: number): Promise<GeneratedPaperDto> {
    const rule = await this.paperRuleRepository.findById(ruleId);
    if (rule?.status !== ContentStatus.PUBLISHED) {
      throw ruleNotFound();
    }
    await this.subjectsService.getPublishedSubject(rule.subjectId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? ruleNotFound() : error;
    });
    const configured = await this.appConfigService.getValue('paper.generateDailyLimit');
    const limit =
      typeof configured === 'number' && Number.isInteger(configured) && configured >= 0
        ? configured
        : DEFAULT_DAILY_LIMIT;

    const recent = await this.paperAttemptRepository.findAnsweredRootIds(
      userId,
      rule.subjectId,
      new Date(Date.now() - RECENT_DAYS * DAY_MS),
    );
    const draft = await this.paperRulesService.draw(rule, recent);
    if (draft.questionCount === 0) {
      throw new BusinessException('noQuestionsAvailable');
    }
    const paperId = await this.paperRepository.createGenerated(
      {
        subjectId: rule.subjectId,
        title: rule.name,
        type: PaperType.GENERATED,
        year: null,
        ownerUserId: userId,
        durationMin: rule.durationMin,
        sections: draft.sections,
        totalScore: draft.totalScore,
        objectiveScore: draft.objectiveScore,
        multiScoringRule: rule.multiScoringRule,
        status: ContentStatus.PUBLISHED,
        isFree: true,
      },
      draft.questions.map((question, index) => ({
        sectionIndex: question.sectionIndex,
        questionId: question.questionId,
        questionVersion: question.questionVersion,
        sort: index,
        score: question.score,
      })),
      { since: businessDayStart(), limit },
    );
    if (!paperId) {
      throw new BusinessException('generateLimitExceeded');
    }
    return { paperId, questionCount: draft.questionCount, insufficient: draft.insufficient.length > 0 };
  }
}
