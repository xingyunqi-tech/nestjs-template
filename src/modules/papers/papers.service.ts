import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaperContent, PaperQuestionData, PaperRepository } from './infrastructure/persistence/paper.repository';
import { Paper } from './domain/paper';
import { PaperType } from './domain/paper-type';
import { MultiScoringRule } from './domain/multi-scoring-rule';
import { sumPaperScores } from './domain/paper-score';
import { CreatePaperDto, PAPER_LIMITS } from './dto/create-paper.dto';
import { PaperImportInput } from './paper-import';
import { UpdatePaperDto } from './dto/update-paper.dto';
import { PAPER_QUESTION_LIMITS, SetPaperQuestionsDto } from './dto/set-paper-questions.dto';
import { PaperFilterOptions } from './dto/query-admin-paper.dto';
import { AdminPaperDto, AdminPaperQuestionDto } from './dto/admin-paper.dto';
import { PublicPaperDetailDto, PublicPaperDto } from './dto/public-paper.dto';
import { QueryPublicPaperDto } from './dto/query-public-paper.dto';
import { ContentStatus } from '../exams/domain/content-status';
import { SubjectsService } from '../exams/subjects.service';
import { QuestionsService } from '../questions/questions.service';
import { QuestionStatus } from '../questions/domain/question-status';
import { QuestionType } from '../questions/domain/question-type';
import { IPaginationOptions } from '../../common/types/pagination-options';

type UserId = number | string;
type ViewerId = UserId | null;

const COPY_SUFFIX = '（副本）';

function notFound(): NotFoundException {
  return new NotFoundException({ error: 'paperNotFound' });
}

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function toPublic(paper: Paper): PublicPaperDto {
  const dto = new PublicPaperDto();
  dto.id = paper.id;
  dto.subjectId = paper.subjectId;
  dto.title = paper.title;
  dto.type = paper.type;
  dto.year = paper.year;
  dto.durationMin = paper.durationMin;
  dto.questionCount = paper.questionCount;
  dto.totalScore = paper.totalScore;
  dto.isFree = paper.isFree;
  dto.attemptCount = paper.attemptCount;
  dto.lastScore = null;
  dto.bestScore = null;
  return dto;
}

function viewerNumber(viewerUserId: ViewerId): number | null {
  return viewerUserId === null ? null : Number(viewerUserId);
}

@Injectable()
export class PapersService {
  constructor(
    private readonly paperRepository: PaperRepository,
    private readonly subjectsService: SubjectsService,
    private readonly questionsService: QuestionsService,
  ) {}

  findManyWithPaginationAndCount(options: {
    filterOptions?: PaperFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Paper[]; total: number }> {
    return this.paperRepository.findManyWithPaginationAndCount(options);
  }

  async findById(id: Paper['id']): Promise<Paper> {
    const paper = await this.paperRepository.findById(id);
    if (!paper) {
      throw notFound();
    }
    return paper;
  }

  async getAdminDetail(id: Paper['id'], viewerUserId: UserId): Promise<AdminPaperDto> {
    const paper = await this.findById(id);
    const rows = await this.paperRepository.findQuestions(id);
    const questions = new Map(
      (await this.questionsService.findByIds(rows.map((row) => row.questionId))).map((question) => [
        question.id,
        question,
      ]),
    );
    const stems = await this.questionsService.resolveFileTexts(
      rows.map((row) => questions.get(row.questionId)!.stem),
      viewerUserId,
    );
    const dto = Object.assign(new AdminPaperDto(), paper);
    dto.questions = rows.map((row, index) => {
      const question = questions.get(row.questionId)!;
      return Object.assign(new AdminPaperQuestionDto(), row, {
        parentId: question.parentId,
        type: question.type,
        status: question.status,
        currentVersion: question.currentVersion,
        stem: stems[index],
      });
    });
    return dto;
  }

  async create(dto: CreatePaperDto, viewerUserId: UserId): Promise<AdminPaperDto> {
    await this.assertSubject(dto.subjectId);
    const paper = await this.paperRepository.create({
      subjectId: dto.subjectId,
      title: dto.title,
      type: dto.type,
      year: dto.year ?? null,
      ownerUserId: null,
      durationMin: dto.durationMin,
      sections: [],
      totalScore: 0,
      objectiveScore: 0,
      multiScoringRule: dto.multiScoringRule ?? MultiScoringRule.ALL_OR_NOTHING,
      status: ContentStatus.DRAFT,
      isFree: dto.isFree ?? true,
    });
    return this.getAdminDetail(paper.id, viewerUserId);
  }

  async update(id: Paper['id'], dto: UpdatePaperDto, viewerUserId: UserId): Promise<AdminPaperDto> {
    const paper = await this.findById(id);
    const changesScoring =
      (dto.type !== undefined && dto.type !== paper.type) ||
      (dto.multiScoringRule !== undefined && dto.multiScoringRule !== paper.multiScoringRule);
    if (changesScoring && paper.status !== ContentStatus.DRAFT) {
      throw new ConflictException({ error: 'paperFrozen' });
    }
    await this.paperRepository.update(id, {
      title: dto.title,
      type: dto.type,
      year: dto.year,
      durationMin: dto.durationMin,
      multiScoringRule: dto.multiScoringRule,
      isFree: dto.isFree,
    });
    return this.getAdminDetail(id, viewerUserId);
  }

  /** 整体替换分区与题目；材料按小题展开记分，版本取各题当前版本 */
  async setQuestions(id: Paper['id'], dto: SetPaperQuestionsDto, viewerUserId: UserId): Promise<AdminPaperDto> {
    const paper = await this.findById(id);
    if (paper.status !== ContentStatus.DRAFT) {
      throw new ConflictException({ error: 'paperFrozen' });
    }
    const { content, rows } = await this.buildQuestionRows(paper.subjectId, dto);
    if (!(await this.paperRepository.replaceQuestions(id, content, rows))) {
      throw new ConflictException({ error: 'paperFrozen' });
    }
    return this.getAdminDetail(id, viewerUserId);
  }

  /** 新建或更新草稿试卷并整体设置题目，可选直接发布，在一个事务内完成 */
  async importPaper(input: PaperImportInput): Promise<Paper['id']> {
    await this.assertSubject(input.subjectId);
    if (input.id) {
      const existing = await this.paperRepository.findById(input.id);
      if (existing?.subjectId !== input.subjectId) {
        throw unprocessable('id', 'paperNotFound');
      }
      if (existing.status !== ContentStatus.DRAFT) {
        throw new ConflictException({ error: 'paperFrozen' });
      }
    }
    const { content, rows } = await this.buildQuestionRows(input.subjectId, input.questions);
    if (input.publish && rows.length === 0) {
      throw new ConflictException({ error: 'paperHasNoQuestions' });
    }
    const id = await this.paperRepository.saveWithQuestions(
      input.id,
      {
        subjectId: input.subjectId,
        title: input.fields.title,
        type: input.fields.type,
        year: input.fields.year ?? null,
        ownerUserId: null,
        durationMin: input.fields.durationMin,
        sections: content.sections,
        totalScore: content.totalScore,
        objectiveScore: content.objectiveScore,
        multiScoringRule: input.fields.multiScoringRule ?? MultiScoringRule.ALL_OR_NOTHING,
        status: input.publish ? ContentStatus.PUBLISHED : ContentStatus.DRAFT,
        isFree: input.fields.isFree ?? true,
      },
      rows,
    );
    if (!id) {
      throw new ConflictException({ error: 'paperFrozen' });
    }
    return id;
  }

  async publish(id: Paper['id'], viewerUserId: UserId): Promise<AdminPaperDto> {
    const paper = await this.findById(id);
    if (paper.status === ContentStatus.DRAFT) {
      const rows = await this.paperRepository.findQuestions(id);
      if (rows.length === 0) {
        throw new ConflictException({ error: 'paperHasNoQuestions' });
      }
      const questions = await this.questionsService.findByIds(rows.map((row) => row.questionId));
      if (questions.some((question) => question.status !== QuestionStatus.PUBLISHED)) {
        throw new ConflictException({ error: 'paperQuestionNotPublished' });
      }
    }
    return this.transition(id, [ContentStatus.DRAFT, ContentStatus.OFFLINE], ContentStatus.PUBLISHED, viewerUserId);
  }

  async offline(id: Paper['id'], viewerUserId: UserId): Promise<AdminPaperDto> {
    await this.findById(id);
    return this.transition(id, [ContentStatus.PUBLISHED], ContentStatus.OFFLINE, viewerUserId);
  }

  /** 复制为草稿，保留题目、版本与分值 */
  async copy(id: Paper['id'], viewerUserId: UserId): Promise<AdminPaperDto> {
    const paper = await this.paperRepository.copy(id, (source) => ({
      subjectId: source.subjectId,
      title: `${source.title.slice(0, PAPER_LIMITS.titleLength - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
      type: source.type === PaperType.GENERATED ? PaperType.MOCK : source.type,
      year: source.year,
      ownerUserId: null,
      durationMin: source.durationMin,
      sections: source.sections,
      totalScore: source.totalScore,
      objectiveScore: source.objectiveScore,
      multiScoringRule: source.multiScoringRule,
      status: ContentStatus.DRAFT,
      isFree: source.isFree,
    }));
    if (!paper) {
      throw notFound();
    }
    return this.getAdminDetail(paper.id, viewerUserId);
  }

  async remove(id: Paper['id']): Promise<void> {
    await this.findById(id);
    if (!(await this.paperRepository.removeDraft(id))) {
      throw new ConflictException({ error: 'onlyDraftDeletable' });
    }
  }

  async findCatalog(
    subjectId: string,
    query: QueryPublicPaperDto,
    viewerUserId: ViewerId,
  ): Promise<{ data: PublicPaperDto[]; total: number; paginationOptions: IPaginationOptions }> {
    await this.subjectsService.getPublishedSubject(subjectId);
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.paperRepository.findCatalog(
      { subjectId, type: query.type, viewerUserId: viewerNumber(viewerUserId) },
      paginationOptions,
    );
    return { data: data.map(toPublic), total, paginationOptions };
  }

  async getPublicDetail(id: Paper['id'], viewerUserId: ViewerId): Promise<PublicPaperDetailDto> {
    const paper = await this.paperRepository.findById(id);
    const visible =
      paper?.status === ContentStatus.PUBLISHED &&
      (paper.type !== PaperType.GENERATED || paper.ownerUserId === viewerNumber(viewerUserId));
    if (!paper || !visible) {
      throw notFound();
    }
    if (paper.type !== PaperType.GENERATED) {
      await this.subjectsService.getPublishedSubject(paper.subjectId).catch((error: unknown) => {
        throw error instanceof NotFoundException ? notFound() : error;
      });
    }
    const rows = await this.paperRepository.findQuestions(id);
    const dto = Object.assign(new PublicPaperDetailDto(), toPublic(paper));
    dto.sections = paper.sections.map((section, index) => ({
      title: section.title,
      questionType: section.questionType,
      questionCount: rows.filter((row) => row.sectionIndex === index).length,
    }));
    dto.objectiveScore = paper.objectiveScore;
    dto.multiScoringRule = paper.multiScoringRule;
    return dto;
  }

  private async transition(
    id: Paper['id'],
    from: ContentStatus[],
    to: ContentStatus,
    viewerUserId: UserId,
  ): Promise<AdminPaperDto> {
    if (!(await this.paperRepository.transitionStatus(id, from, to))) {
      throw new ConflictException({ error: 'invalidStatusTransition' });
    }
    return this.getAdminDetail(id, viewerUserId);
  }

  private async buildQuestionRows(
    subjectId: Paper['subjectId'],
    dto: SetPaperQuestionsDto,
  ): Promise<{ content: PaperContent; rows: PaperQuestionData[] }> {
    const rootIds = dto.questions.map((item) => item.questionId);
    if (new Set(rootIds).size !== rootIds.length) {
      throw unprocessable('questions', 'duplicatePaperQuestion');
    }
    dto.questions.forEach((item, index) => {
      if (item.sectionIndex >= dto.sections.length) {
        throw unprocessable('questions', 'invalidPaperSection');
      }
      if (index > 0 && item.sectionIndex < dto.questions[index - 1].sectionIndex) {
        throw unprocessable('questions', 'invalidPaperSection');
      }
    });

    const units = new Map((await this.questionsService.findUnits(rootIds)).map((unit) => [unit.root.id, unit]));
    const rows: (PaperQuestionData & { type: QuestionType })[] = [];
    for (const item of dto.questions) {
      const unit = units.get(item.questionId);
      if (unit?.root.subjectId !== subjectId) {
        throw unprocessable('questions', 'paperQuestionNotFound');
      }
      if (unit.questions.some((question) => question.status !== QuestionStatus.PUBLISHED)) {
        throw unprocessable('questions', 'paperQuestionNotPublished');
      }
      if (item.childScores && item.childScores.length !== unit.questions.length) {
        throw unprocessable('questions', 'invalidChildScores');
      }
      unit.questions.forEach((question, index) => {
        rows.push({
          sectionIndex: item.sectionIndex,
          questionId: question.id,
          questionVersion: question.currentVersion,
          sort: rows.length,
          score: item.childScores?.[index] ?? item.score,
          type: question.type,
        });
      });
    }

    const { totalScore, objectiveScore } = sumPaperScores(rows);
    if (totalScore > PAPER_QUESTION_LIMITS.maxTotalScore) {
      throw unprocessable('questions', 'paperScoreTooHigh');
    }
    return {
      content: {
        sections: dto.sections.map(({ title, questionType }) => ({ title, questionType })),
        totalScore,
        objectiveScore,
      },
      rows: rows.map(({ type: _type, ...row }) => row),
    };
  }

  private async assertSubject(subjectId: string): Promise<void> {
    await this.subjectsService.findById(subjectId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? unprocessable('subjectId', 'subjectNotFound') : error;
    });
  }
}
