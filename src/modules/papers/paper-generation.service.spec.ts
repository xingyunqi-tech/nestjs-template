import type { Mocked } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PaperGenerationService } from './paper-generation.service';
import { PaperRepository } from './infrastructure/persistence/paper.repository';
import { PaperRuleRepository } from './infrastructure/persistence/paper-rule.repository';
import { PaperAttemptRepository } from './infrastructure/persistence/paper-attempt.repository';
import { PaperRulesService } from './paper-rules.service';
import { PaperRule } from './domain/paper-rule';
import { PaperType } from './domain/paper-type';
import { MultiScoringRule } from './domain/multi-scoring-rule';
import { businessDayStart } from './domain/business-date';
import { PaperDraftDto } from './dto/paper-draft.dto';
import { ContentStatus } from '../exams/domain/content-status';
import { SubjectsService } from '../exams/subjects.service';
import { QuestionType } from '../questions/domain/question-type';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const USER = 6;

const draft = (questionCount: number): PaperDraftDto => ({
  sections: [{ title: '单选', questionType: QuestionType.SINGLE }],
  questions: Array.from({ length: questionCount }, (_, index) => ({
    sectionIndex: 0,
    questionId: `q${index}`,
    parentId: null,
    type: QuestionType.SINGLE,
    questionVersion: 2,
    score: 1.5,
    stem: '',
    fileUrls: {},
  })),
  questionCount,
  totalScore: questionCount * 1.5,
  objectiveScore: questionCount * 1.5,
  insufficient: questionCount < 3 ? [{ itemIndex: 0, requested: 3, drawn: questionCount }] : [],
});

describe('PaperGenerationService', () => {
  let rule: PaperRule;
  let papers: Mocked<Pick<PaperRepository, 'createGenerated'>>;
  let attempts: Mocked<Pick<PaperAttemptRepository, 'findAnsweredRootIds'>>;
  let rulesService: Mocked<Pick<PaperRulesService, 'draw'>>;
  let config: Record<string, unknown>;
  let service: PaperGenerationService;

  beforeEach(() => {
    rule = Object.assign(new PaperRule(), {
      id: 'r1',
      subjectId: 's1',
      name: '规则卷',
      durationMin: 45,
      multiScoringRule: MultiScoringRule.PARTIAL,
      items: [],
      status: ContentStatus.PUBLISHED,
    });
    papers = { createGenerated: vi.fn().mockResolvedValue('p9') };
    attempts = { findAnsweredRootIds: vi.fn().mockResolvedValue(['old1']) };
    rulesService = { draw: vi.fn().mockResolvedValue(draft(3)) };
    config = {};
    service = new PaperGenerationService(
      papers as unknown as PaperRepository,
      { findById: vi.fn(() => Promise.resolve(rule)) } as unknown as PaperRuleRepository,
      attempts as unknown as PaperAttemptRepository,
      rulesService as unknown as PaperRulesService,
      { getPublishedSubject: vi.fn().mockResolvedValue({}) } as unknown as SubjectsService,
      { getValue: vi.fn((key: string) => Promise.resolve(config[key])) } as unknown as AppConfigService,
    );
  });

  it('should create a published generated paper owned by the user excluding recent questions first', async () => {
    const before = Date.now();
    await expect(service.generate('r1', USER)).resolves.toEqual({
      paperId: 'p9',
      questionCount: 3,
      insufficient: false,
    });

    const [userId, subjectId, since] = attempts.findAnsweredRootIds.mock.calls[0];
    expect([userId, subjectId]).toEqual([USER, 's1']);
    expect(since!.getTime()).toBeLessThanOrEqual(before - 30 * 86_400_000 + 1000);
    expect(rulesService.draw).toHaveBeenCalledWith(rule, ['old1']);
    const [data, rows, quota] = papers.createGenerated.mock.calls[0];
    expect(data).toMatchObject({
      type: PaperType.GENERATED,
      status: ContentStatus.PUBLISHED,
      ownerUserId: USER,
      title: '规则卷',
      durationMin: 45,
      multiScoringRule: MultiScoringRule.PARTIAL,
      totalScore: 4.5,
    });
    expect(rows[2]).toEqual({ sectionIndex: 0, questionId: 'q2', questionVersion: 2, sort: 2, score: 1.5 });
    expect(quota).toEqual({ since: businessDayStart(), limit: 5 });
  });

  it('should apply the configured daily limit and report exceeding it', async () => {
    config['paper.generateDailyLimit'] = 2;
    papers.createGenerated.mockResolvedValue(null);

    const error = await service.generate('r1', USER).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).errorKey).toBe('generateLimitExceeded');
    expect(papers.createGenerated.mock.calls[0][2].limit).toBe(2);
  });

  it('should reject unpublished rules and rules without questions', async () => {
    rulesService.draw.mockResolvedValue(draft(0));
    await expect(service.generate('r1', USER)).rejects.toMatchObject({ errorKey: 'noQuestionsAvailable' });

    rule.status = ContentStatus.DRAFT;
    await expect(service.generate('r1', USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(papers.createGenerated).not.toHaveBeenCalled();
  });
});
