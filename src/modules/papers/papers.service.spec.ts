import type { Mocked } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PapersService } from './papers.service';
import { PaperRepository } from './infrastructure/persistence/paper.repository';
import { Paper } from './domain/paper';
import { PaperType } from './domain/paper-type';
import { MultiScoringRule } from './domain/multi-scoring-rule';
import { PaperQuestion } from './domain/paper-question';
import { SetPaperQuestionsDto } from './dto/set-paper-questions.dto';
import { ContentStatus } from '../exams/domain/content-status';
import { SubjectsService } from '../exams/subjects.service';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionStatus } from '../questions/domain/question-status';
import { QuestionUnit } from '../questions/domain/question-unit';

const SUBJECT = 's1';

const paper = (overrides: Partial<Paper> = {}): Paper =>
  Object.assign(new Paper(), {
    id: 'p1',
    subjectId: SUBJECT,
    title: '模拟卷',
    type: PaperType.MOCK,
    year: null,
    ownerUserId: null,
    durationMin: 120,
    sections: [],
    totalScore: 0,
    objectiveScore: 0,
    multiScoringRule: MultiScoringRule.ALL_OR_NOTHING,
    status: ContentStatus.DRAFT,
    isFree: true,
    attemptCount: 0,
    questionCount: 0,
    ...overrides,
  });

const question = (id: string, overrides: Partial<Question> = {}): Question =>
  Object.assign(new Question(), {
    id,
    subjectId: SUBJECT,
    parentId: null,
    type: QuestionType.SINGLE,
    status: QuestionStatus.PUBLISHED,
    currentVersion: 1,
    stem: `题干 ${id}`,
    ...overrides,
  });

const single = question('q1', { currentVersion: 3 });
const essay = question('q2', { type: QuestionType.ESSAY });
const material = question('m1', { type: QuestionType.MATERIAL });
const children = [
  question('c1', { parentId: 'm1', currentVersion: 2 }),
  question('c2', { parentId: 'm1', type: QuestionType.FILL }),
];
const UNITS: Record<string, QuestionUnit> = {
  q1: { root: single, questions: [single] },
  q2: { root: essay, questions: [essay] },
  m1: { root: material, questions: children },
};

const sections = [
  { title: '选择题', questionType: QuestionType.SINGLE },
  { title: '材料题', questionType: QuestionType.MATERIAL },
];

describe('PapersService', () => {
  let repository: Mocked<PaperRepository>;
  let subjectsService: Mocked<Pick<SubjectsService, 'findById' | 'getPublishedSubject'>>;
  let questionsService: Mocked<Pick<QuestionsService, 'findUnits' | 'findByIds' | 'resolveFileTexts'>>;
  let service: PapersService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue(paper()),
      findManyWithPaginationAndCount: vi.fn(),
      findCatalog: vi.fn(),
      update: vi.fn(),
      transitionStatus: vi.fn().mockResolvedValue(true),
      findQuestions: vi.fn().mockResolvedValue([]),
      replaceQuestions: vi.fn().mockResolvedValue(true),
      copy: vi.fn(),
      removeDraft: vi.fn().mockResolvedValue(true),
    };
    subjectsService = { findById: vi.fn(), getPublishedSubject: vi.fn().mockResolvedValue({ id: SUBJECT }) };
    questionsService = {
      findUnits: vi.fn((ids: string[]) => Promise.resolve(ids.flatMap((id) => UNITS[id] ?? []))),
      findByIds: vi.fn((ids: string[]) =>
        Promise.resolve(ids.flatMap((id) => [single, essay, ...children].find((item) => item.id === id) ?? [])),
      ),
      resolveFileTexts: vi.fn((texts: string[]) => Promise.resolve(texts.map((text) => `resolved:${text}`))),
    };
    service = new PapersService(
      repository,
      subjectsService as unknown as SubjectsService,
      questionsService as unknown as QuestionsService,
    );
  });

  describe('setQuestions', () => {
    const dto = (questions: SetPaperQuestionsDto['questions']): SetPaperQuestionsDto => ({ sections, questions });

    it('should expand materials into sub-questions with current versions and derived scores', async () => {
      await service.setQuestions(
        'p1',
        dto([
          { questionId: 'q1', sectionIndex: 0, score: 1.5 },
          { questionId: 'q2', sectionIndex: 0, score: 20 },
          { questionId: 'm1', sectionIndex: 1, score: 2, childScores: [2, 3.25] },
        ]),
        1,
      );

      expect(repository.replaceQuestions).toHaveBeenCalledWith(
        'p1',
        { sections, totalScore: 26.75, objectiveScore: 6.75 },
        [
          { sectionIndex: 0, questionId: 'q1', questionVersion: 3, sort: 0, score: 1.5 },
          { sectionIndex: 0, questionId: 'q2', questionVersion: 1, sort: 1, score: 20 },
          { sectionIndex: 1, questionId: 'c1', questionVersion: 2, sort: 2, score: 2 },
          { sectionIndex: 1, questionId: 'c2', questionVersion: 1, sort: 3, score: 3.25 },
        ],
      );
    });

    it('should apply the material score to every sub-question by default', async () => {
      await service.setQuestions('p1', dto([{ questionId: 'm1', sectionIndex: 1, score: 2 }]), 1);

      const [, content, rows] = repository.replaceQuestions.mock.calls[0];
      expect(rows.map((row) => row.score)).toEqual([2, 2]);
      expect(content.totalScore).toBe(4);
    });

    it('should reject changes to a published paper', async () => {
      repository.findById.mockResolvedValue(paper({ status: ContentStatus.PUBLISHED }));

      await expect(
        service.setQuestions('p1', dto([{ questionId: 'q1', sectionIndex: 0, score: 1 }]), 1),
      ).rejects.toMatchObject({ response: { error: 'paperFrozen' } });
      expect(repository.replaceQuestions).not.toHaveBeenCalled();
    });

    it('should reject when the paper is published concurrently', async () => {
      repository.replaceQuestions.mockResolvedValue(false);

      await expect(
        service.setQuestions('p1', dto([{ questionId: 'q1', sectionIndex: 0, score: 1 }]), 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      ['unpublished question', { status: QuestionStatus.OFFLINE }, 'paperQuestionNotPublished'],
      ['question of another subject', { subjectId: 'other' }, 'paperQuestionNotFound'],
    ])('should reject a %s', async (_name, overrides, error) => {
      questionsService.findUnits.mockResolvedValue([
        { root: question('x', overrides), questions: [question('x', overrides)] },
      ]);

      await expect(
        service.setQuestions('p1', dto([{ questionId: 'x', sectionIndex: 0, score: 1 }]), 1),
      ).rejects.toMatchObject({ response: { errors: { questions: error } } });
    });

    it.each([
      ['sub-question ids', [{ questionId: 'c1', sectionIndex: 0, score: 1 }], 'paperQuestionNotFound'],
      [
        'duplicates',
        [
          { questionId: 'q1', sectionIndex: 0, score: 1 },
          { questionId: 'q1', sectionIndex: 0, score: 1 },
        ],
        'duplicatePaperQuestion',
      ],
      ['unknown sections', [{ questionId: 'q1', sectionIndex: 2, score: 1 }], 'invalidPaperSection'],
      [
        'sections out of order',
        [
          { questionId: 'm1', sectionIndex: 1, score: 1 },
          { questionId: 'q1', sectionIndex: 0, score: 1 },
        ],
        'invalidPaperSection',
      ],
      [
        'mismatched sub-question scores',
        [{ questionId: 'm1', sectionIndex: 1, score: 1, childScores: [1] }],
        'invalidChildScores',
      ],
      [
        'scores over the limit',
        [{ questionId: 'm1', sectionIndex: 1, score: 1, childScores: [9999, 1] }],
        'paperScoreTooHigh',
      ],
    ])('should reject %s', async (_name, questions, error) => {
      await expect(service.setQuestions('p1', dto(questions), 1)).rejects.toMatchObject({
        response: { errors: { questions: error } },
      });
    });
  });

  describe('update', () => {
    it('should allow editing display fields of a published paper', async () => {
      repository.findById.mockResolvedValue(paper({ status: ContentStatus.PUBLISHED }));

      await service.update('p1', { title: '新标题', durationMin: 90 }, 1);

      expect(repository.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ title: '新标题', durationMin: 90 }),
      );
    });

    it('should reject scoring changes once published', async () => {
      repository.findById.mockResolvedValue(paper({ status: ContentStatus.OFFLINE }));

      await expect(service.update('p1', { multiScoringRule: MultiScoringRule.PARTIAL }, 1)).rejects.toMatchObject({
        response: { error: 'paperFrozen' },
      });
      await expect(service.update('p1', { type: PaperType.REAL }, 1)).rejects.toMatchObject({
        response: { error: 'paperFrozen' },
      });
    });
  });

  describe('publish', () => {
    const row = (questionId: string): PaperQuestion =>
      Object.assign(new PaperQuestion(), {
        paperId: 'p1',
        questionId,
        sectionIndex: 0,
        sort: 0,
        score: 1,
        questionVersion: 1,
      });

    it('should reject a paper without questions', async () => {
      await expect(service.publish('p1', 1)).rejects.toMatchObject({ response: { error: 'paperHasNoQuestions' } });
    });

    it('should reject a draft whose questions were taken offline', async () => {
      repository.findQuestions.mockResolvedValue([row('q1')]);
      questionsService.findByIds.mockResolvedValue([question('q1', { status: QuestionStatus.OFFLINE })]);

      await expect(service.publish('p1', 1)).rejects.toMatchObject({
        response: { error: 'paperQuestionNotPublished' },
      });
    });

    it('should publish a draft with published questions', async () => {
      repository.findQuestions.mockResolvedValue([row('q1')]);

      await service.publish('p1', 1);

      expect(repository.transitionStatus).toHaveBeenCalledWith(
        'p1',
        [ContentStatus.DRAFT, ContentStatus.OFFLINE],
        ContentStatus.PUBLISHED,
      );
    });

    it('should report invalid transitions', async () => {
      repository.findById.mockResolvedValue(paper({ status: ContentStatus.PUBLISHED }));
      repository.transitionStatus.mockResolvedValue(false);

      await expect(service.publish('p1', 1)).rejects.toMatchObject({ response: { error: 'invalidStatusTransition' } });
    });
  });

  describe('copy', () => {
    it('should derive a draft with a suffixed title from the locked source', async () => {
      repository.copy.mockResolvedValue(paper({ id: 'p2' }));

      await service.copy('p1', 1);

      const derive = repository.copy.mock.calls[0][1];
      expect(repository.copy.mock.calls[0][0]).toBe('p1');
      expect(
        derive(paper({ status: ContentStatus.PUBLISHED, type: PaperType.GENERATED, ownerUserId: 7, totalScore: 10 })),
      ).toMatchObject({
        title: '模拟卷（副本）',
        type: PaperType.MOCK,
        ownerUserId: null,
        status: ContentStatus.DRAFT,
        totalScore: 10,
      });
    });

    it('should report a missing source', async () => {
      repository.copy.mockResolvedValue(null);

      await expect(service.copy('p1', 1)).rejects.toMatchObject({ response: { error: 'paperNotFound' } });
    });
  });

  describe('getAdminDetail', () => {
    it('should resolve file references in stems for the viewer', async () => {
      repository.findQuestions.mockResolvedValue([
        Object.assign(new PaperQuestion(), { paperId: 'p1', questionId: 'q1', sectionIndex: 0, sort: 0, score: 1 }),
      ]);

      const detail = await service.getAdminDetail('p1', 5);

      expect(questionsService.resolveFileTexts).toHaveBeenCalledWith(['题干 q1'], 5);
      expect(detail.questions[0]).toMatchObject({ questionId: 'q1', stem: 'resolved:题干 q1', currentVersion: 3 });
    });
  });

  describe('remove', () => {
    it('should only delete drafts', async () => {
      repository.removeDraft.mockResolvedValue(false);

      await expect(service.remove('p1')).rejects.toMatchObject({ response: { error: 'onlyDraftDeletable' } });
    });
  });

  describe('public catalog', () => {
    it('should hide generated papers of other users', async () => {
      repository.findById.mockResolvedValue(
        paper({ status: ContentStatus.PUBLISHED, type: PaperType.GENERATED, ownerUserId: 7 }),
      );

      await expect(service.getPublicDetail('p1', 8)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getPublicDetail('p1', null)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getPublicDetail('p1', 7)).resolves.toMatchObject({ id: 'p1' });
    });

    it('should hide papers of unpublished subjects except generated papers', async () => {
      subjectsService.getPublishedSubject.mockRejectedValue(new NotFoundException({ error: 'subjectNotFound' }));
      repository.findById.mockResolvedValue(paper({ status: ContentStatus.PUBLISHED }));

      await expect(service.getPublicDetail('p1', null)).rejects.toMatchObject({ response: { error: 'paperNotFound' } });

      repository.findById.mockResolvedValue(
        paper({ status: ContentStatus.PUBLISHED, type: PaperType.GENERATED, ownerUserId: 7 }),
      );
      await expect(service.getPublicDetail('p1', 7)).resolves.toMatchObject({ id: 'p1' });
    });

    it('should hide unpublished papers', async () => {
      await expect(service.getPublicDetail('p1', null)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should summarize sections without personal scores', async () => {
      repository.findById.mockResolvedValue(
        paper({ status: ContentStatus.PUBLISHED, sections, questionCount: 3, totalScore: 5 }),
      );
      repository.findQuestions.mockResolvedValue([
        Object.assign(new PaperQuestion(), { sectionIndex: 0 }),
        Object.assign(new PaperQuestion(), { sectionIndex: 1 }),
        Object.assign(new PaperQuestion(), { sectionIndex: 1 }),
      ]);

      const detail = await service.getPublicDetail('p1', null);

      expect(detail.sections.map((section) => section.questionCount)).toEqual([1, 2]);
      expect(detail).toMatchObject({ questionCount: 3, totalScore: 5, lastScore: null, bestScore: null });
    });

    it('should list the catalog of a published subject for the viewer', async () => {
      repository.findCatalog.mockResolvedValue({ data: [paper()], total: 1 });

      const result = await service.findCatalog(SUBJECT, { page: 2, limit: 5, type: PaperType.REAL }, '9');

      expect(subjectsService.getPublishedSubject).toHaveBeenCalledWith(SUBJECT);
      expect(repository.findCatalog).toHaveBeenCalledWith(
        { subjectId: SUBJECT, type: PaperType.REAL, viewerUserId: 9 },
        { page: 2, limit: 5 },
      );
      expect(result.data[0]).not.toHaveProperty('ownerUserId');
    });
  });

  describe('create', () => {
    it('should report a missing subject as a validation error', async () => {
      subjectsService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({ subjectId: 'x', title: 't', type: PaperType.REAL, durationMin: 60 }, 1),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});
