import type { Mocked } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PracticeReportService } from './practice-report.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { AnswerVisibilityService } from './answer-visibility.service';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, ScoringScheme } from './domain/practice-session';
import { AnswerRecord, SelfAssessment } from './domain/answer-record';
import { HiddenReason } from './domain/hidden-reason';
import { AnswerCardStatus } from './dto/practice-report.dto';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { KnowledgePoint } from '../exams/domain/knowledge-point';
import { PapersService } from '../papers/papers.service';
import { Paper } from '../papers/domain/paper';
import { PaperType } from '../papers/domain/paper-type';
import { PaperQuestion } from '../papers/domain/paper-question';

const USER = 4;

const question = (id: string, type: QuestionType, knowledgePointIds: string[]): Question =>
  Object.assign(new Question(), { id, type, parentId: null, knowledgePointIds });

const QUESTIONS = [
  question('q1', QuestionType.SINGLE, ['kp1']),
  question('q2', QuestionType.MULTIPLE, ['kp1']),
  question('q3', QuestionType.SINGLE, ['kp2']),
  question('q4', QuestionType.SHORT_ANSWER, ['kp2']),
  question('q5', QuestionType.SHORT_ANSWER, ['kp2']),
  question('q6', QuestionType.SINGLE, ['kp2']),
];

const record = (questionId: string, fields: Partial<AnswerRecord>): AnswerRecord =>
  Object.assign(new AnswerRecord(), {
    questionId,
    answer: { any: true },
    isCorrect: null,
    isPartial: false,
    score: null,
    selfAssessment: null,
    gradingStatus: null,
    markedForReview: false,
    ...fields,
  });

describe('PracticeReportService', () => {
  let session: PracticeSession;
  let repository: Mocked<
    Pick<PracticeSessionRepository, 'findById' | 'findRecords' | 'findWrongQuestionIds' | 'findPercentileSample'>
  >;
  let visibility: Mocked<Pick<AnswerVisibilityService, 'evaluate'>>;
  let papersService: Mocked<Pick<PapersService, 'findById' | 'findQuestions'>>;
  let service: PracticeReportService;

  beforeEach(() => {
    session = Object.assign(new PracticeSession(), {
      id: 'session-1',
      userId: USER,
      mode: PracticeMode.MOCK,
      paperId: 'p1',
      status: PracticeSessionStatus.SUBMITTED,
      scope: {},
      questionIds: QUESTIONS.map((item) => item.id),
      questionVersions: {},
      scoringScheme: ScoringScheme.OBJECTIVE_ONLY,
      score: 3,
      totalScore: 8,
      correctCount: 2,
      answeredCount: 5,
      durationSec: 1200,
      pendingGrading: false,
    });
    repository = {
      findById: vi.fn(() => Promise.resolve(session)),
      findRecords: vi
        .fn()
        .mockResolvedValue([
          record('q1', { isCorrect: true, score: 2 }),
          record('q2', { isCorrect: false, isPartial: true, score: 1 }),
          record('q3', { isCorrect: false, score: 0 }),
          record('q4', {}),
          record('q5', { isCorrect: true, selfAssessment: SelfAssessment.KNOWN }),
        ]),
      findWrongQuestionIds: vi.fn().mockResolvedValue(['q2', 'q3']),
      findPercentileSample: vi.fn().mockResolvedValue({ below: 3, total: 4 }),
    };
    visibility = {
      evaluate: vi.fn((_userId, items: { questionId: string }[]) =>
        Promise.resolve(
          items.map((item) =>
            item.questionId === 'q3'
              ? { visible: false, hiddenReason: HiddenReason.MOCK_IN_PROGRESS }
              : { visible: true, hiddenReason: null },
          ),
        ),
      ),
    };
    papersService = {
      findById: vi.fn().mockResolvedValue(Object.assign(new Paper(), { type: PaperType.REAL })),
      findQuestions: vi
        .fn()
        .mockResolvedValue(
          QUESTIONS.map((item) => Object.assign(new PaperQuestion(), { questionId: item.id, score: 2 })),
        ),
    };
    service = new PracticeReportService(
      repository as unknown as PracticeSessionRepository,
      visibility as unknown as AnswerVisibilityService,
      { findByIds: vi.fn().mockResolvedValue(QUESTIONS) } as unknown as QuestionsService,
      {
        findByIds: vi.fn((ids: string[]) =>
          Promise.resolve(ids.map((id) => Object.assign(new KnowledgePoint(), { id, name: `名称${id}` }))),
        ),
      } as unknown as KnowledgePointsService,
      papersService as unknown as PapersService,
    );
  });

  it('should build the answer card with statuses and hide results of questions in an ongoing mock', async () => {
    const report = await service.getReport(USER, session.id);

    expect(report.card.map((item) => item.status)).toEqual([
      AnswerCardStatus.CORRECT,
      AnswerCardStatus.PARTIAL,
      null,
      AnswerCardStatus.PENDING_SELF_ASSESSMENT,
      AnswerCardStatus.CORRECT,
      AnswerCardStatus.UNANSWERED,
    ]);
    expect(report.card[2]).toMatchObject({ score: null, hiddenReason: HiddenReason.MOCK_IN_PROGRESS, fullScore: 2 });
    expect(report.selfAssessment.pendingQuestionIds).toEqual(['q4']);
    expect(visibility.evaluate).toHaveBeenCalledWith(USER, expect.any(Array), 'session');
    expect(report).toMatchObject({
      score: 3,
      totalScore: 8,
      accuracy: 0.3333,
      durationSec: 1200,
      wrongQuestionCount: 1,
    });
  });

  it('should report accuracy by question type and knowledge point without hidden questions', async () => {
    const report = await service.getReport(USER, session.id);

    expect(report.byType).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: QuestionType.SINGLE, total: 2, answered: 1, correct: 1, accuracy: 0.5 }),
        expect.objectContaining({ type: QuestionType.SHORT_ANSWER, total: 2, answered: 2, correct: 1, accuracy: 0.5 }),
      ]),
    );
    expect(report.byKnowledgePoint).toEqual([
      expect.objectContaining({ knowledgePointId: 'kp1', name: '名称kp1', total: 2, correct: 1 }),
      expect.objectContaining({ knowledgePointId: 'kp2', total: 3, answered: 2, correct: 1 }),
    ]);
  });

  it('should compare against first submissions of the same scoring scheme except generated papers', async () => {
    const report = await service.getReport(USER, session.id);
    expect(repository.findPercentileSample).toHaveBeenCalledWith(session, 3);
    expect(report.percentile).toEqual({ beatRatio: 0.75, sampleSize: 4 });

    repository.findPercentileSample.mockResolvedValue({ below: 0, total: 0 });
    expect((await service.getReport(USER, session.id)).percentile).toEqual({ beatRatio: null, sampleSize: 0 });

    papersService.findById.mockResolvedValue(Object.assign(new Paper(), { type: PaperType.GENERATED }));
    expect((await service.getReport(USER, session.id)).percentile).toBeNull();
  });

  it('should only report finished sessions of the owner', async () => {
    session.status = PracticeSessionStatus.IN_PROGRESS;
    await expect(service.getReport(USER, session.id)).rejects.toMatchObject({
      errorKey: 'reportNotAvailable',
      status: 409,
    });
    await expect(service.getReport(99, session.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
