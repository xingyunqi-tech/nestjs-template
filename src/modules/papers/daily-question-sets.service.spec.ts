import type { Mocked } from 'vitest';
import { DailyQuestionSetsService } from './daily-question-sets.service';
import { DailyQuestionSetRepository } from './infrastructure/persistence/daily-question-set.repository';
import { DailySetUsageRepository } from './infrastructure/persistence/daily-set-usage.repository';
import { DailyQuestionSet } from './domain/daily-question-set';
import { businessDate } from './domain/business-date';
import { SubjectsService } from '../exams/subjects.service';
import { Subject } from '../exams/domain/subject';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionUnit } from '../questions/domain/question-unit';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const SUBJECT = 's1';

const question = (id: string, overrides: Partial<Question> = {}): Question =>
  Object.assign(new Question(), {
    id,
    subjectId: SUBJECT,
    parentId: null,
    type: QuestionType.SINGLE,
    answer: { keys: ['B'] },
    ...overrides,
  });

const set = (questionIds: string[], date = businessDate()): DailyQuestionSet =>
  Object.assign(new DailyQuestionSet(), { id: 'd1', subjectId: SUBJECT, date, questionIds });

const single = question('q1');
const material = question('m1', { type: QuestionType.MATERIAL, answer: null });
const subQuestions = [
  question('c1', { parentId: 'm1', type: QuestionType.JUDGE, answer: { value: true } }),
  question('c2', { parentId: 'm1', type: QuestionType.ESSAY, answer: {} }),
];
const tail = question('q2');
const UNITS: QuestionUnit[] = [
  { root: single, questions: [single] },
  { root: material, questions: subQuestions },
  { root: tail, questions: [tail] },
];

describe('DailyQuestionSetsService', () => {
  let repository: Mocked<DailyQuestionSetRepository>;
  let usage: Mocked<DailySetUsageRepository>;
  let subjectsService: Mocked<Pick<SubjectsService, 'findById' | 'getPublishedSubject' | 'findAllPublished'>>;
  let questionsService: Mocked<
    Pick<
      QuestionsService,
      'drawUnits' | 'findUnitsByQuestionIds' | 'toPublicUnits' | 'findSummariesByIds' | 'resolveFileUrls'
    >
  >;
  let config: Record<string, unknown>;
  let service: DailyQuestionSetsService;

  beforeEach(() => {
    repository = {
      findOne: vi.fn().mockResolvedValue(null),
      insertIfAbsent: vi.fn((subjectId, date, questionIds) => Promise.resolve(set(questionIds, date))),
      upsert: vi.fn((subjectId, date, questionIds) => Promise.resolve(set(questionIds, date))),
      findRange: vi.fn().mockResolvedValue([]),
    };
    usage = { hasSessions: vi.fn().mockResolvedValue(false) };
    subjectsService = {
      findById: vi.fn(),
      getPublishedSubject: vi.fn(),
      findAllPublished: vi.fn().mockResolvedValue([]),
    };
    questionsService = {
      drawUnits: vi.fn().mockResolvedValue(UNITS),
      findUnitsByQuestionIds: vi.fn().mockResolvedValue(UNITS),
      toPublicUnits: vi.fn((units: QuestionUnit[]) =>
        Promise.resolve(units.map((unit) => ({ id: unit.root.id }) as never)),
      ),
      findSummariesByIds: vi.fn((ids: string[]) =>
        Promise.resolve(
          ids
            .flatMap((id) => [single, ...subQuestions].filter((item) => item.id === id))
            .map(({ id, parentId, type }) => ({ id, parentId, type, stem: `题干 ${id}` })),
        ),
      ),
      resolveFileUrls: vi.fn((sources: { stem?: string }[]) =>
        Promise.resolve(sources.map((source) => ({ f1: `url:${source.stem}` }))),
      ),
    };
    config = {};
    const appConfigService = { getValue: vi.fn((key: string) => Promise.resolve(config[key])) };
    service = new DailyQuestionSetsService(
      repository,
      usage,
      subjectsService as unknown as SubjectsService,
      questionsService as unknown as QuestionsService,
      appConfigService as unknown as AppConfigService,
    );
  });

  describe('ensure', () => {
    it('should keep an existing set', async () => {
      repository.findOne.mockResolvedValue(set(['q9']));

      await expect(service.ensure(SUBJECT, '2026-10-17')).resolves.toMatchObject({ questionIds: ['q9'] });
      expect(questionsService.drawUnits).not.toHaveBeenCalled();
    });

    it('should generate with the configured size and insert only when absent', async () => {
      config['practice.dailySetSize'] = 4;

      await service.ensure(SUBJECT, '2026-10-17');

      expect(questionsService.drawUnits).toHaveBeenCalledWith({ subjectId: SUBJECT }, 4);
      expect(repository.insertIfAbsent).toHaveBeenCalledWith(SUBJECT, '2026-10-17', ['q1', 'c1', 'c2', 'q2']);
    });

    it('should fall back to the default size for invalid configuration', async () => {
      config['practice.dailySetSize'] = -1;

      await service.ensure(SUBJECT, '2026-10-17');

      expect(questionsService.drawUnits).toHaveBeenCalledWith({ subjectId: SUBJECT }, 10);
    });

    it('should not store an empty set', async () => {
      questionsService.drawUnits.mockResolvedValue([]);

      await expect(service.ensure(SUBJECT, '2026-10-17')).resolves.toBeNull();
      expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    });
  });

  it('should generate for every published subject and continue after failures', async () => {
    subjectsService.findAllPublished.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Subject[]);
    questionsService.drawUnits
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(UNITS);

    await expect(service.generateForPublishedSubjects('2026-10-17')).resolves.toBe(1);
    expect(repository.insertIfAbsent).toHaveBeenCalledTimes(1);
  });

  describe('trial', () => {
    beforeEach(() => {
      repository.findOne.mockResolvedValue(set(['q1', 'c1', 'c2', 'q2']));
    });

    it('should return the leading questions with whole materials', async () => {
      config['practice.trialSize'] = 2;

      const trial = await service.getTrial(SUBJECT);

      expect(subjectsService.getPublishedSubject).toHaveBeenCalledWith(SUBJECT);
      expect(trial).toMatchObject({ subjectId: SUBJECT, date: businessDate(), questionCount: 3 });
      expect(questionsService.toPublicUnits).toHaveBeenCalledWith(UNITS.slice(0, 2), null);
    });

    it('should grade answers within the trial without exposing answers', async () => {
      const result = await service.checkTrial(SUBJECT, {
        date: businessDate(),
        answers: [
          { questionId: 'q1', answer: { keys: ['B'] } },
          { questionId: 'c1', answer: { value: false } },
          { questionId: 'c2', answer: { text: '作答' } },
        ],
      });

      expect(result.results).toEqual([
        { questionId: 'q1', isCorrect: true },
        { questionId: 'c1', isCorrect: false },
        { questionId: 'c2', isCorrect: null },
      ]);
    });

    it('should reject questions beyond the trial', async () => {
      await expect(
        service.checkTrial(SUBJECT, { date: businessDate(), answers: [{ questionId: 'q2', answer: { keys: ['B'] } }] }),
      ).rejects.toMatchObject({ response: { errors: { answers: 'questionNotInTrial' } } });
    });

    it('should grade against the set of yesterday without generating it', async () => {
      const yesterday = businessDate(new Date(Date.now() - 86_400_000));
      repository.findOne.mockResolvedValue(set(['q1'], yesterday));

      await expect(
        service.checkTrial(SUBJECT, { date: yesterday, answers: [{ questionId: 'q1', answer: { keys: ['B'] } }] }),
      ).resolves.toEqual({ results: [{ questionId: 'q1', isCorrect: true }] });
      expect(repository.findOne).toHaveBeenCalledWith(SUBJECT, yesterday);
      expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it('should reject trial dates other than today or yesterday', async () => {
      await expect(
        service.checkTrial(SUBJECT, { date: '2000-01-01', answers: [{ questionId: 'q1', answer: {} }] }),
      ).rejects.toMatchObject({ response: { errors: { date: 'invalidTrialDate' } } });
    });

    it('should return an empty trial when the subject has no questions', async () => {
      repository.findOne.mockResolvedValue(null);
      questionsService.drawUnits.mockResolvedValue([]);

      await expect(service.getTrial(SUBJECT)).resolves.toMatchObject({ questionCount: 0 });
      await expect(service.getSummary(SUBJECT)).resolves.toMatchObject({ questionCount: 0, completion: null });
    });
  });

  describe('regenerate', () => {
    it('should replace the set of today', async () => {
      const today = businessDate();

      await expect(service.regenerate(SUBJECT, today)).resolves.toMatchObject({ date: today });
      expect(usage.hasSessions).toHaveBeenCalledWith(SUBJECT, today);
      expect(repository.upsert).toHaveBeenCalledWith(SUBJECT, today, ['q1', 'c1', 'c2', 'q2']);
    });

    it('should reject past dates and invalid dates', async () => {
      await expect(service.regenerate(SUBJECT, '2000-01-01')).rejects.toMatchObject({
        response: { errors: { date: 'dailySetDateInPast' } },
      });
      await expect(service.regenerate(SUBJECT, '2099-02-30')).rejects.toMatchObject({
        response: { errors: { date: 'invalidDate' } },
      });
    });

    it('should reject sets already used by sessions', async () => {
      usage.hasSessions.mockResolvedValue(true);

      await expect(service.regenerate(SUBJECT, businessDate())).rejects.toMatchObject({
        response: { error: 'dailySetInUse' },
      });
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('should reject when no questions are available', async () => {
      questionsService.drawUnits.mockResolvedValue([]);

      await expect(service.regenerate(SUBJECT, businessDate())).rejects.toBeInstanceOf(BusinessException);
    });
  });

  describe('findRange', () => {
    it('should list sets in the range', async () => {
      await service.findRange(SUBJECT, '2026-10-01', '2026-10-31', 5);

      expect(repository.findRange).toHaveBeenCalledWith(SUBJECT, '2026-10-01', '2026-10-31');
    });

    it('should attach question summaries in set order with one lookup', async () => {
      repository.findRange.mockResolvedValue([
        set(['c1', 'c2', 'q1'], '2026-10-01'),
        set(['q1', 'gone'], '2026-10-02'),
      ]);

      const sets = await service.findRange(SUBJECT, '2026-10-01', '2026-10-31', 5);

      expect(questionsService.findSummariesByIds).toHaveBeenCalledTimes(1);
      expect(questionsService.findSummariesByIds).toHaveBeenCalledWith(['c1', 'c2', 'q1', 'gone']);
      expect(questionsService.resolveFileUrls).toHaveBeenCalledWith(
        [{ stem: '题干 c1' }, { stem: '题干 c2' }, { stem: '题干 q1' }],
        5,
      );
      expect(sets[0].questions).toEqual([
        { id: 'c1', parentId: 'm1', type: QuestionType.JUDGE, stem: '题干 c1', fileUrls: { f1: 'url:题干 c1' } },
        { id: 'c2', parentId: 'm1', type: QuestionType.ESSAY, stem: '题干 c2', fileUrls: { f1: 'url:题干 c2' } },
        { id: 'q1', parentId: null, type: QuestionType.SINGLE, stem: '题干 q1', fileUrls: { f1: 'url:题干 q1' } },
      ]);
      expect(sets[1].questions.map((question) => question.id)).toEqual(['q1']);
    });

    it('should reject inverted or oversized ranges', async () => {
      await expect(service.findRange(SUBJECT, '2026-10-31', '2026-10-01', 5)).rejects.toMatchObject({
        response: { errors: { to: 'invalidDateRange' } },
      });
      await expect(service.findRange(SUBJECT, '2025-01-01', '2026-10-01', 5)).rejects.toMatchObject({
        response: { errors: { to: 'invalidDateRange' } },
      });
    });
  });
});
