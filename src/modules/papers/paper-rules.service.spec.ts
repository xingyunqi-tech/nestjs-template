import type { Mocked } from 'vitest';
import { PaperRulesService } from './paper-rules.service';
import { PaperRuleRepository } from './infrastructure/persistence/paper-rule.repository';
import { PaperRule } from './domain/paper-rule';
import { MultiScoringRule } from './domain/multi-scoring-rule';
import { ContentStatus } from '../exams/domain/content-status';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionUnit } from '../questions/domain/question-unit';

const SUBJECT = 's1';

const question = (id: string, type = QuestionType.SINGLE, parentId: string | null = null): Question =>
  Object.assign(new Question(), { id, subjectId: SUBJECT, parentId, type, currentVersion: 1, stem: id });

const unit = (root: Question, questions: Question[] = [root]): QuestionUnit => ({ root, questions });

const rule = (items: PaperRule['items']): PaperRule =>
  Object.assign(new PaperRule(), {
    id: 'r1',
    subjectId: SUBJECT,
    name: '规则',
    durationMin: 60,
    multiScoringRule: MultiScoringRule.ALL_OR_NOTHING,
    items,
    status: ContentStatus.DRAFT,
  });

describe('PaperRulesService', () => {
  let repository: Mocked<PaperRuleRepository>;
  let knowledgePointsService: Mocked<Pick<KnowledgePointsService, 'findByIds'>>;
  let questionsService: Mocked<Pick<QuestionsService, 'drawUnits' | 'resolveFileUrls'>>;
  let service: PaperRulesService;
  let subjectsService: Mocked<Pick<SubjectsService, 'findById' | 'getPublishedSubject'>>;

  beforeEach(() => {
    subjectsService = {
      findById: vi.fn().mockResolvedValue({ id: SUBJECT }),
      getPublishedSubject: vi.fn().mockResolvedValue({ id: SUBJECT }),
    };
    repository = {
      create: vi.fn((data) => Promise.resolve(Object.assign(new PaperRule(), data))),
      findById: vi.fn(),
      findManyWithPaginationAndCount: vi.fn(),
      update: vi.fn(),
      updateDraft: vi.fn(),
      removeDraft: vi.fn(),
      findPublishedBySubject: vi.fn().mockResolvedValue([]),
    };
    knowledgePointsService = { findByIds: vi.fn().mockResolvedValue([]) };
    questionsService = { drawUnits: vi.fn(), resolveFileUrls: vi.fn() };
    service = new PaperRulesService(
      repository,
      subjectsService as unknown as SubjectsService,
      knowledgePointsService as unknown as KnowledgePointsService,
      questionsService as unknown as QuestionsService,
    );
  });

  describe('findPublishedSummaries', () => {
    it('should summarize published rules of a published subject', async () => {
      repository.findPublishedBySubject.mockResolvedValue([
        rule([
          { sectionTitle: '单选', questionType: QuestionType.SINGLE, count: 3, scorePerQuestion: 1.5 },
          { sectionTitle: '判断', questionType: QuestionType.JUDGE, count: 2, scorePerQuestion: 0.35 },
        ]),
      ]);

      await expect(service.findPublishedSummaries(SUBJECT)).resolves.toEqual([
        { id: 'r1', name: '规则', durationMin: 60, questionCount: 5, totalScore: 5.2 },
      ]);
      expect(subjectsService.getPublishedSubject).toHaveBeenCalledWith(SUBJECT);
      expect(repository.findPublishedBySubject).toHaveBeenCalledWith(SUBJECT);
    });
  });

  describe('draw', () => {
    it('should draw per item without repeating roots and merge sections by title', async () => {
      const material = question('m1', QuestionType.MATERIAL);
      questionsService.drawUnits
        .mockResolvedValueOnce([unit(question('q1')), unit(question('q2'))])
        .mockResolvedValueOnce([
          unit(material, [question('c1', QuestionType.FILL, 'm1'), question('c2', QuestionType.ESSAY, 'm1')]),
        ])
        .mockResolvedValueOnce([unit(question('q3'))]);

      const draft = await service.draw(
        rule([
          {
            sectionTitle: '单选',
            questionType: QuestionType.SINGLE,
            count: 2,
            scorePerQuestion: 1,
            difficultyRange: [2, 4],
          },
          { sectionTitle: '资料分析', questionType: QuestionType.MATERIAL, count: 3, scorePerQuestion: 2 },
          {
            sectionTitle: '单选',
            questionType: QuestionType.SINGLE,
            count: 1,
            scorePerQuestion: 1.5,
            knowledgePointIds: ['k1'],
          },
        ]),
      );

      expect(draft.sections).toEqual([
        { title: '单选', questionType: QuestionType.SINGLE },
        { title: '资料分析', questionType: QuestionType.MATERIAL },
      ]);
      expect(draft.questions.map((item) => [item.questionId, item.sectionIndex, item.score])).toEqual([
        ['q1', 0, 1],
        ['q2', 0, 1],
        ['q3', 0, 1.5],
        ['c1', 1, 2],
        ['c2', 1, 2],
      ]);
      expect(draft).toMatchObject({ questionCount: 5, totalScore: 7.5, objectiveScore: 5.5 });
      expect(draft.insufficient).toEqual([{ itemIndex: 1, requested: 3, drawn: 2 }]);
      expect(questionsService.drawUnits).toHaveBeenNthCalledWith(
        1,
        { subjectId: SUBJECT, type: QuestionType.SINGLE, difficultyRange: [2, 4], excludeRootIds: expect.any(Array) },
        2,
      );
      expect(questionsService.drawUnits.mock.calls[2][0]).toMatchObject({
        knowledgePointIds: ['k1'],
        excludeRootIds: ['q1', 'q2', 'm1'],
      });
    });

    it('should prefer excluding the given roots and relax when the item is short', async () => {
      questionsService.drawUnits
        .mockResolvedValueOnce([unit(question('q1'))])
        .mockResolvedValueOnce([unit(question('old'))]);

      const draft = await service.draw(
        rule([{ sectionTitle: '单选', questionType: QuestionType.SINGLE, count: 2, scorePerQuestion: 1 }]),
        ['old'],
      );

      expect(draft.questions.map((item) => item.questionId)).toEqual(['q1', 'old']);
      expect(draft.insufficient).toEqual([]);
      expect(
        questionsService.drawUnits.mock.calls.map(([criteria, count]) => [criteria.excludeRootIds, count]),
      ).toEqual([
        [['old'], 2],
        [['q1'], 1],
      ]);
    });
  });

  describe('create', () => {
    const dto = {
      subjectId: SUBJECT,
      name: '规则',
      durationMin: 60,
      items: [
        {
          sectionTitle: '单选',
          questionType: QuestionType.SINGLE,
          count: 5,
          scorePerQuestion: 1,
          knowledgePointIds: ['k1'],
        },
      ],
    };

    it('should create a draft rule', async () => {
      knowledgePointsService.findByIds.mockResolvedValue([{ id: 'k1', subjectId: SUBJECT }] as never);

      await expect(service.create(dto)).resolves.toMatchObject({
        status: ContentStatus.DRAFT,
        multiScoringRule: MultiScoringRule.ALL_OR_NOTHING,
      });
    });

    it('should reject knowledge points of other subjects', async () => {
      knowledgePointsService.findByIds.mockResolvedValue([{ id: 'k1', subjectId: 'other' }] as never);

      await expect(service.create(dto)).rejects.toMatchObject({
        response: { errors: { items: 'invalidKnowledgePoint' } },
      });
    });

    it('should reject missing knowledge points and inverted difficulty ranges', async () => {
      knowledgePointsService.findByIds.mockResolvedValue([]);
      await expect(service.create(dto)).rejects.toMatchObject({
        response: { errors: { items: 'invalidKnowledgePoint' } },
      });

      await expect(
        service.create({
          ...dto,
          items: [
            {
              sectionTitle: '单选',
              questionType: QuestionType.SINGLE,
              count: 1,
              scorePerQuestion: 1,
              difficultyRange: [4, 2],
            },
          ],
        }),
      ).rejects.toMatchObject({ response: { errors: { items: 'invalidDifficultyRange' } } });
    });

    const item = (overrides: object) => ({
      sectionTitle: '单选',
      questionType: QuestionType.SINGLE,
      count: 1,
      scorePerQuestion: 1,
      ...overrides,
    });

    it.each([
      [
        'sections sharing a title with different types',
        [item({}), item({ questionType: QuestionType.JUDGE })],
        'paperSectionTypeConflict',
      ],
      [
        'too many questions',
        [item({ count: 200 }), item({ count: 200 }), item({ count: 101 })],
        'paperQuestionLimitExceeded',
      ],
      ['total scores over the limit', [item({ count: 100, scorePerQuestion: 100.01 })], 'paperScoreTooHigh'],
    ])('should reject %s', async (_name, items, error) => {
      await expect(service.create({ ...dto, items })).rejects.toMatchObject({ response: { errors: { items: error } } });
    });

    it('should look up knowledge points in one batch', async () => {
      knowledgePointsService.findByIds.mockResolvedValue([
        { id: 'k1', subjectId: SUBJECT },
        { id: 'k2', subjectId: SUBJECT },
      ] as never);

      await service.create({
        ...dto,
        items: [
          item({ knowledgePointIds: ['k1', 'k2'] }),
          item({ sectionTitle: '判断', questionType: QuestionType.JUDGE, knowledgePointIds: ['k1'] }),
        ],
      });

      expect(knowledgePointsService.findByIds).toHaveBeenCalledTimes(1);
      expect(knowledgePointsService.findByIds).toHaveBeenCalledWith(['k1', 'k2']);
    });
  });

  it('should keep raw preview stems and attach file urls for the administrator', async () => {
    repository.findById.mockResolvedValue(
      rule([{ sectionTitle: '单选', questionType: QuestionType.SINGLE, count: 1, scorePerQuestion: 1 }]),
    );
    questionsService.drawUnits.mockResolvedValue([unit(question('q1'))]);
    questionsService.resolveFileUrls.mockResolvedValue([{ f1: 'https://cdn.example.com/a.png' }]);

    const draft = await service.preview('r1', 5);

    expect(questionsService.resolveFileUrls).toHaveBeenCalledWith([{ stem: 'q1' }], 5);
    expect(draft.questions[0]).toMatchObject({ stem: 'q1', fileUrls: { f1: 'https://cdn.example.com/a.png' } });
  });

  it('should update a draft rule through the draft-only write when restricted to drafts', async () => {
    const updated = rule([]);
    repository.findById.mockResolvedValue(rule([]));
    repository.updateDraft.mockResolvedValue(updated);

    await expect(service.update('r1', { name: '新规则' }, { draftOnly: true })).resolves.toBe(updated);
    expect(repository.updateDraft).toHaveBeenCalledWith('r1', expect.objectContaining({ name: '新规则' }));
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([ContentStatus.PUBLISHED, ContentStatus.OFFLINE])(
    'should refuse a draft-only update of a %s rule',
    async (status) => {
      repository.findById.mockResolvedValue(Object.assign(rule([]), { status }));

      await expect(service.update('r1', { name: '新规则' }, { draftOnly: true })).rejects.toMatchObject({
        response: { error: 'paperRuleReviewRequired' },
      });
      expect(repository.updateDraft).not.toHaveBeenCalled();
    },
  );

  it('should refuse a draft-only update when the rule leaves draft before the write', async () => {
    repository.findById.mockResolvedValue(rule([]));
    repository.updateDraft.mockResolvedValue(null);

    await expect(service.update('r1', { name: '新规则' }, { draftOnly: true })).rejects.toMatchObject({
      response: { error: 'paperRuleReviewRequired' },
    });
  });

  it('should report missing rules on remove', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.remove('r1')).rejects.toMatchObject({ response: { error: 'paperRuleNotFound' } });
    expect(repository.removeDraft).not.toHaveBeenCalled();
  });

  it('should remove a draft rule', async () => {
    repository.findById.mockResolvedValue(rule([]));
    repository.removeDraft.mockResolvedValue(true);

    await service.remove('r1');

    expect(repository.removeDraft).toHaveBeenCalledWith('r1');
  });

  it('should refuse to remove a rule that is not a draft', async () => {
    repository.findById.mockResolvedValue(Object.assign(rule([]), { status: ContentStatus.PUBLISHED }));
    repository.removeDraft.mockResolvedValue(false);

    await expect(service.remove('r1')).rejects.toMatchObject({ response: { error: 'onlyDraftDeletable' } });
  });
});
