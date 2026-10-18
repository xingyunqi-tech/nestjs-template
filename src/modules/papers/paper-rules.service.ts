import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaperRuleRepository } from './infrastructure/persistence/paper-rule.repository';
import { PaperRule, PaperRuleItem } from './domain/paper-rule';
import { PaperSection } from './domain/paper-section';
import { MultiScoringRule } from './domain/multi-scoring-rule';
import { sumPaperScores } from './domain/paper-score';
import { CreatePaperRuleDto } from './dto/create-paper-rule.dto';
import { UpdatePaperRuleDto } from './dto/update-paper-rule.dto';
import { PaperRuleItemDto } from './dto/paper-rule-item.dto';
import { PaperRuleFilterOptions } from './dto/query-admin-paper-rule.dto';
import { PaperDraftDto, PaperDraftQuestionDto, PaperRuleShortageDto } from './dto/paper-draft.dto';
import { PaperRuleSummaryDto } from './dto/paper-rule-summary.dto';
import { PAPER_QUESTION_LIMITS } from './dto/set-paper-questions.dto';
import { ContentStatus } from '../exams/domain/content-status';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { QuestionsService } from '../questions/questions.service';
import { IPaginationOptions } from '../../common/types/pagination-options';

function notFound(): NotFoundException {
  return new NotFoundException({ error: 'paperRuleNotFound' });
}

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function toItem(dto: PaperRuleItemDto): PaperRuleItem {
  return {
    sectionTitle: dto.sectionTitle,
    questionType: dto.questionType,
    ...(dto.knowledgePointIds?.length && { knowledgePointIds: [...dto.knowledgePointIds] }),
    ...(dto.difficultyRange && { difficultyRange: [dto.difficultyRange[0], dto.difficultyRange[1]] }),
    count: dto.count,
    scorePerQuestion: dto.scorePerQuestion,
  };
}

@Injectable()
export class PaperRulesService {
  constructor(
    private readonly paperRuleRepository: PaperRuleRepository,
    private readonly subjectsService: SubjectsService,
    private readonly knowledgePointsService: KnowledgePointsService,
    private readonly questionsService: QuestionsService,
  ) {}

  findManyWithPaginationAndCount(options: {
    filterOptions?: PaperRuleFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: PaperRule[]; total: number }> {
    return this.paperRuleRepository.findManyWithPaginationAndCount(options);
  }

  async findById(id: PaperRule['id']): Promise<PaperRule> {
    const rule = await this.paperRuleRepository.findById(id);
    if (!rule) {
      throw notFound();
    }
    return rule;
  }

  /** 已发布科目下已发布的组卷规则 */
  async findPublishedSummaries(subjectId: string): Promise<PaperRuleSummaryDto[]> {
    await this.subjectsService.getPublishedSubject(subjectId);
    const rules = await this.paperRuleRepository.findPublishedBySubject(subjectId);
    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      durationMin: rule.durationMin,
      questionCount: rule.items.reduce((sum, item) => sum + item.count, 0),
      totalScore: rule.items.reduce((sum, item) => sum + item.count * Math.round(item.scorePerQuestion * 100), 0) / 100,
    }));
  }

  async create(dto: CreatePaperRuleDto): Promise<PaperRule> {
    await this.subjectsService.findById(dto.subjectId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? unprocessable('subjectId', 'subjectNotFound') : error;
    });
    const items = await this.validateItems(dto.subjectId, dto.items);
    return this.paperRuleRepository.create({
      subjectId: dto.subjectId,
      name: dto.name,
      durationMin: dto.durationMin,
      multiScoringRule: dto.multiScoringRule ?? MultiScoringRule.ALL_OR_NOTHING,
      items,
      status: ContentStatus.DRAFT,
    });
  }

  async update(id: PaperRule['id'], dto: UpdatePaperRuleDto): Promise<PaperRule> {
    const rule = await this.findById(id);
    const items = dto.items ? await this.validateItems(rule.subjectId, dto.items) : undefined;
    const updated = await this.paperRuleRepository.update(id, {
      name: dto.name,
      durationMin: dto.durationMin,
      multiScoringRule: dto.multiScoringRule,
      items,
      status: dto.status,
    });
    if (!updated) {
      throw notFound();
    }
    return updated;
  }

  async remove(id: PaperRule['id']): Promise<void> {
    if (!(await this.paperRuleRepository.remove(id))) {
      throw notFound();
    }
  }

  async preview(id: PaperRule['id'], viewerUserId: number | string): Promise<PaperDraftDto> {
    const draft = await this.draw(await this.findById(id));
    const fileUrls = await this.questionsService.resolveFileUrls(
      draft.questions.map(({ stem }) => ({ stem })),
      viewerUserId,
    );
    draft.questions.forEach((question, index) => {
      question.fileUrls = fileUrls[index];
    });
    return draft;
  }

  /** 按规则项依次抽题，跨规则项不重复；同名分区合并；优先排除 preferExcludedRootIds，题量不足时放宽 */
  async draw(rule: PaperRule, preferExcludedRootIds: string[] = []): Promise<PaperDraftDto> {
    const sections: PaperSection[] = [];
    const questions: PaperDraftQuestionDto[] = [];
    const insufficient: PaperRuleShortageDto[] = [];
    const usedRootIds: string[] = [];

    for (const [itemIndex, item] of rule.items.entries()) {
      let sectionIndex = sections.findIndex((section) => section.title === item.sectionTitle);
      if (sectionIndex < 0) {
        sectionIndex = sections.push({ title: item.sectionTitle, questionType: item.questionType }) - 1;
      }
      const criteria = {
        subjectId: rule.subjectId,
        type: item.questionType,
        knowledgePointIds: item.knowledgePointIds,
        difficultyRange: item.difficultyRange,
      };
      const units = await this.questionsService.drawUnits(
        { ...criteria, excludeRootIds: [...usedRootIds, ...preferExcludedRootIds] },
        item.count,
      );
      const preferred = units.reduce((sum, unit) => sum + unit.questions.length, 0);
      if (preferExcludedRootIds.length > 0 && preferred < item.count) {
        units.push(
          ...(await this.questionsService.drawUnits(
            { ...criteria, excludeRootIds: [...usedRootIds, ...units.map((unit) => unit.root.id)] },
            item.count - preferred,
          )),
        );
      }
      let drawn = 0;
      for (const unit of units) {
        usedRootIds.push(unit.root.id);
        for (const question of unit.questions) {
          drawn += 1;
          questions.push({
            sectionIndex,
            questionId: question.id,
            parentId: question.parentId,
            type: question.type,
            questionVersion: question.currentVersion,
            score: item.scorePerQuestion,
            stem: question.stem,
            fileUrls: {},
          });
        }
      }
      if (drawn < item.count) {
        insufficient.push({ itemIndex, requested: item.count, drawn });
      }
    }

    const ordered = questions
      .map((question, index) => ({ question, index }))
      .sort((a, b) => a.question.sectionIndex - b.question.sectionIndex || a.index - b.index)
      .map(({ question }) => question);
    return {
      sections,
      questions: ordered,
      questionCount: ordered.length,
      ...sumPaperScores(ordered),
      insufficient,
    };
  }

  private async validateItems(subjectId: string, items: PaperRuleItemDto[]): Promise<PaperRuleItem[]> {
    const knowledgePointIds = [...new Set(items.flatMap((item) => item.knowledgePointIds ?? []))];
    if (knowledgePointIds.length > 0) {
      const points = await this.knowledgePointsService.findByIds(knowledgePointIds);
      if (points.length !== knowledgePointIds.length || points.some((point) => point.subjectId !== subjectId)) {
        throw unprocessable('items', 'invalidKnowledgePoint');
      }
    }
    if (items.some((item) => item.difficultyRange && item.difficultyRange[0] > item.difficultyRange[1])) {
      throw unprocessable('items', 'invalidDifficultyRange');
    }
    const sectionTypes = new Map<string, string>();
    for (const item of items) {
      const type = sectionTypes.get(item.sectionTitle) ?? item.questionType;
      if (type !== item.questionType) {
        throw unprocessable('items', 'paperSectionTypeConflict');
      }
      sectionTypes.set(item.sectionTitle, type);
    }
    if (items.reduce((sum, item) => sum + item.count, 0) > PAPER_QUESTION_LIMITS.questions) {
      throw unprocessable('items', 'paperQuestionLimitExceeded');
    }
    const totalCents = items.reduce((sum, item) => sum + item.count * Math.round(item.scorePerQuestion * 100), 0);
    if (totalCents > Math.round(PAPER_QUESTION_LIMITS.maxTotalScore * 100)) {
      throw unprocessable('items', 'paperScoreTooHigh');
    }
    return items.map(toItem);
  }
}
