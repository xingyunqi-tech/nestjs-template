import type { Mocked } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { WrongBookService } from './wrong-book.service';
import { WrongQuestionRepository } from './infrastructure/persistence/wrong-question.repository';
import { WrongQuestion, WrongQuestionStatus } from './domain/wrong-question';
import { AppConfigService } from '../config/config.service';
import { StatsRecord } from '../study-stats/domain/stats-record';
import { PracticeMode } from '../practice/domain/practice-mode';
import { SelfAssessment } from '../practice/domain/answer-record';
import { QuestionType } from '../questions/domain/question-type';
import { TransactionHandle } from '../../common/database/transaction-handle';

const handle = {} as TransactionHandle;

const record = (overrides: Partial<StatsRecord> = {}): StatsRecord => ({
  id: 'r1',
  sessionId: 's1',
  userId: 7,
  subjectId: 'sub1',
  mode: PracticeMode.RANDOM,
  questionId: 'q1',
  questionType: QuestionType.SINGLE,
  questionSubjectId: 'question-subject',
  knowledgePointIds: ['kp1'],
  answer: { keys: ['A'] },
  isCorrect: false,
  isPartial: false,
  selfAssessment: null,
  durationSec: 12,
  gradedAt: new Date('2026-10-17T02:00:00Z'),
  statDate: '2026-10-17',
  firstForQuestion: false,
  ...overrides,
});

describe('WrongBookService', () => {
  let repository: Mocked<WrongQuestionRepository>;
  let config: Mocked<Pick<AppConfigService, 'getValue'>>;
  let service: WrongBookService;

  beforeEach(() => {
    repository = {
      recordWrong: vi.fn().mockResolvedValue(undefined),
      recordCorrect: vi.fn().mockResolvedValue(undefined),
      rebuildFromRecords: vi.fn().mockResolvedValue(undefined),
      findActivePublishedQuestionIds: vi.fn().mockResolvedValue([]),
      findQuestionIdsInBook: vi.fn().mockResolvedValue([]),
      findManyWithPaginationAndCount: vi.fn(),
      countSummary: vi.fn(),
      master: vi.fn(),
      restore: vi.fn(),
      removeByUser: vi.fn(),
    };
    config = { getValue: vi.fn().mockResolvedValue(3) };
    service = new WrongBookService(repository, config as unknown as AppConfigService);
  });

  describe('applyStatsRecord', () => {
    it('should upsert a wrong answer with the subject of the question, the graded time and answer', async () => {
      await service.applyStatsRecord(handle, record());

      expect(repository.recordWrong).toHaveBeenCalledWith(handle, {
        userId: 7,
        questionId: 'q1',
        subjectId: 'question-subject',
        answer: { keys: ['A'] },
        wrongAt: new Date('2026-10-17T02:00:00Z'),
      });
      expect(repository.recordCorrect).not.toHaveBeenCalled();
    });

    it('should upsert partially correct answers and subjective answers self-assessed as unknown', async () => {
      await service.applyStatsRecord(handle, record({ questionType: QuestionType.MULTIPLE, isPartial: true }));
      await service.applyStatsRecord(
        handle,
        record({ questionType: QuestionType.SHORT_ANSWER, selfAssessment: SelfAssessment.UNKNOWN }),
      );

      expect(repository.recordWrong).toHaveBeenCalledTimes(2);
    });

    it('should count a correct answer on its stat date with the configured threshold', async () => {
      config.getValue.mockResolvedValue(5);

      await service.applyStatsRecord(handle, record({ isCorrect: true }));

      expect(config.getValue).toHaveBeenCalledWith('wrongBook.masterThreshold');
      expect(repository.recordCorrect).toHaveBeenCalledWith(handle, {
        userId: 7,
        questionId: 'q1',
        statDate: '2026-10-17',
        masterThreshold: 5,
      });
      expect(repository.recordWrong).not.toHaveBeenCalled();
    });

    it('should fall back to a threshold of 3 when the configured value is invalid', async () => {
      config.getValue.mockResolvedValue('abc');

      await service.applyStatsRecord(handle, record({ isCorrect: true }));

      expect(repository.recordCorrect).toHaveBeenCalledWith(handle, expect.objectContaining({ masterThreshold: 3 }));
    });

    it('should not count subjective answers self-assessed as known', async () => {
      await service.applyStatsRecord(
        handle,
        record({ isCorrect: true, questionType: QuestionType.ESSAY, selfAssessment: SelfAssessment.KNOWN }),
      );

      expect(repository.recordCorrect).not.toHaveBeenCalled();
      expect(repository.recordWrong).not.toHaveBeenCalled();
    });
  });

  describe('master and restore', () => {
    const item = Object.assign(new WrongQuestion(), { questionId: 'q1', status: WrongQuestionStatus.MASTERED });

    it('should return the updated wrong question', async () => {
      repository.master.mockResolvedValue(item);
      repository.restore.mockResolvedValue({ ...item, status: WrongQuestionStatus.ACTIVE });

      await expect(service.master(7, 'q1')).resolves.toBe(item);
      await expect(service.restore(7, 'q1')).resolves.toMatchObject({ status: WrongQuestionStatus.ACTIVE });
    });

    it('should reject questions outside the wrong book', async () => {
      repository.master.mockResolvedValue(null);
      repository.restore.mockResolvedValue(null);

      await expect(service.master(7, 'q1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.restore(7, 'q1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
