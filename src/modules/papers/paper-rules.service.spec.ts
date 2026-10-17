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
  let questionsService: Mocked<Pick<QuestionsService, 'drawUnits' | 'resolveFileTexts'>>;
  let service: PaperRulesService;

  beforeEach(() => {
    repository = {
      create: vi.fn((data) => Promise.resolve(Object.assign(new PaperRule(), data))),
      findById: vi.fn(),
      findManyWithPaginationAndCount: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    knowledgePointsService = { findByIds: vi.fn().mockResolvedValue([]) };
    questionsService = { drawUnits: vi.fn(), resolveFileTexts: vi.fn() };
    service = new PaperRulesService(
      repository,
      { findById: vi.fn().mockResolvedValue({ id: SUBJECT }) } as unknown as SubjectsService,
      knowledgePointsService as unknown as KnowledgePointsService,
      questionsService as unknown as QuestionsService,
    );
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

  it('should resolve file references in preview stems for the administrator', async () => {
    repository.findById.mockResolvedValue(
      rule([{ sectionTitle: '单选', questionType: QuestionType.SINGLE, count: 1, scorePerQuestion: 1 }]),
    );
    questionsService.drawUnits.mockResolvedValue([unit(question('q1'))]);
    questionsService.resolveFileTexts.mockResolvedValue(['resolved']);

    const draft = await service.preview('r1', 5);

    expect(questionsService.resolveFileTexts).toHaveBeenCalledWith(['q1'], 5);
    expect(draft.questions[0].stem).toBe('resolved');
  });

  it('should report missing rules on remove', async () => {
    repository.remove.mockResolvedValue(false);

    await expect(service.remove('r1')).rejects.toMatchObject({ response: { error: 'paperRuleNotFound' } });
  });
});
