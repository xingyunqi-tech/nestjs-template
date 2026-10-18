import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { AnswerVisibilityService, Visibility } from './answer-visibility.service';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus } from './domain/practice-session';
import { AnswerRecord, GradingStatus } from './domain/answer-record';
import { isSubjectiveType } from './domain/answer-content';
import {
  AccuracyDto,
  AnswerCardStatus,
  KnowledgePointAccuracyDto,
  PercentileDto,
  PracticeReportDto,
  ReportCardItemDto,
  TypeAccuracyDto,
} from './dto/practice-report.dto';
import { toPracticeSessionDto } from './practice-presenter';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { PapersService } from '../papers/papers.service';
import { PaperType } from '../papers/domain/paper-type';

interface Tally {
  total: number;
  answered: number;
  correct: number;
}

const ratio = (part: number, total: number): number => (total === 0 ? 0 : Math.round((part / total) * 10_000) / 10_000);

function count<K>(tallies: Map<K, Tally>, key: K, answered: number, correct: number): void {
  const tally = tallies.get(key) ?? { total: 0, answered: 0, correct: 0 };
  tallies.set(key, { total: tally.total + 1, answered: tally.answered + answered, correct: tally.correct + correct });
}

function toAccuracy<T extends AccuracyDto>(tally: Tally, target: T): T {
  return Object.assign(target, { ...tally, accuracy: ratio(tally.correct, tally.total) });
}

function cardStatus(question: Question, record: AnswerRecord | undefined): AnswerCardStatus {
  if ((record?.answer ?? null) === null) {
    return AnswerCardStatus.UNANSWERED;
  }
  if (isSubjectiveType(question.type) && record!.selfAssessment === null && record!.isCorrect === null) {
    return AnswerCardStatus.PENDING_SELF_ASSESSMENT;
  }
  if (record!.isCorrect) {
    return AnswerCardStatus.CORRECT;
  }
  if (record!.isPartial) {
    return AnswerCardStatus.PARTIAL;
  }
  return record!.isCorrect === false ? AnswerCardStatus.WRONG : AnswerCardStatus.UNANSWERED;
}

/** 已结束会话的成绩报告；答案不可见的题不返回判分结果，也不计入正确数、错题数与分项正确率 */
@Injectable()
export class PracticeReportService {
  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly answerVisibilityService: AnswerVisibilityService,
    private readonly questionsService: QuestionsService,
    private readonly knowledgePointsService: KnowledgePointsService,
    private readonly papersService: PapersService,
  ) {}

  async getReport(userId: number, sessionId: string): Promise<PracticeReportDto> {
    const session = await this.practiceSessionRepository.findById(sessionId);
    if (session?.userId !== userId) {
      throw new NotFoundException({ error: 'practiceSessionNotFound' });
    }
    if (session.status !== PracticeSessionStatus.SUBMITTED || session.mode === PracticeMode.MEMORIZE) {
      throw new ConflictException({ error: 'reportNotAvailable' });
    }

    const [questions, records, fullScores, wrongIds] = await Promise.all([
      this.questionsService.findByIds(session.questionIds),
      this.practiceSessionRepository.findRecords(session.id),
      this.findFullScores(session),
      this.practiceSessionRepository.findWrongQuestionIds(session),
    ]);
    const questionMap = new Map(questions.map((question) => [question.id, question]));
    const recordMap = new Map(records.map((record) => [record.questionId, record]));
    const ordered = session.questionIds.flatMap((id) => questionMap.get(id) ?? []);
    const visibilities = await this.answerVisibilityService.evaluate(
      userId,
      ordered.map((question) => ({
        questionId: question.id,
        questionType: question.type,
        session,
        record: recordMap.get(question.id),
      })),
    );

    const byType = new Map<QuestionType, Tally>();
    const byPoint = new Map<string, Tally>();
    const card: ReportCardItemDto[] = [];
    const pendingQuestionIds: string[] = [];
    const visibleIds = new Set<string>();
    let correctCount = 0;
    ordered.forEach((question, position) => {
      const record = recordMap.get(question.id);
      const visibility: Visibility = visibilities[position];
      const status = cardStatus(question, record);
      if (visibility.visible) {
        const answered = status !== AnswerCardStatus.UNANSWERED ? 1 : 0;
        const correct = status === AnswerCardStatus.CORRECT ? 1 : 0;
        visibleIds.add(question.id);
        correctCount += correct;
        count(byType, question.type, answered, correct);
        question.knowledgePointIds.forEach((id) => count(byPoint, id, answered, correct));
      }
      if (
        visibility.visible &&
        status === AnswerCardStatus.PENDING_SELF_ASSESSMENT &&
        record?.gradingStatus !== GradingStatus.PENDING
      ) {
        pendingQuestionIds.push(question.id);
      }
      card.push(
        Object.assign(new ReportCardItemDto(), {
          index: session.questionIds.indexOf(question.id),
          questionId: question.id,
          materialId: question.parentId,
          type: question.type,
          status: visibility.visible ? status : null,
          score: visibility.visible ? (record?.score ?? null) : null,
          fullScore: fullScores?.get(question.id) ?? null,
          selfAssessment: visibility.visible ? (record?.selfAssessment ?? null) : null,
          markedForReview: record?.markedForReview ?? false,
          hiddenReason: visibility.hiddenReason,
        }),
      );
    });

    const points = new Map(
      (await this.knowledgePointsService.findByIds([...byPoint.keys()])).map((point) => [point.id, point.name]),
    );
    return {
      session: toPracticeSessionDto(session),
      score: session.score,
      totalScore: session.totalScore,
      questionCount: session.questionIds.length,
      answeredCount: session.answeredCount,
      correctCount,
      accuracy: ratio(correctCount, session.questionIds.length),
      durationSec: session.durationSec,
      percentile: await this.findPercentile(session),
      byType: [...byType].map(([type, tally]) => toAccuracy(tally, Object.assign(new TypeAccuracyDto(), { type }))),
      byKnowledgePoint: [...byPoint]
        .filter(([id]) => points.has(id))
        .map(([id, tally]) =>
          toAccuracy(
            tally,
            Object.assign(new KnowledgePointAccuracyDto(), { knowledgePointId: id, name: points.get(id) }),
          ),
        ),
      card,
      selfAssessment: { pendingQuestionIds },
      wrongQuestionCount: wrongIds.filter((id) => visibleIds.has(id)).length,
    };
  }

  private async findFullScores(session: PracticeSession): Promise<Map<string, number> | null> {
    if (session.mode !== PracticeMode.MOCK || !session.paperId) {
      return null;
    }
    const rows = await this.papersService.findQuestions(session.paperId);
    return new Map(rows.map((row) => [row.questionId, row.score]));
  }

  /** 只与相同计分口径下其他用户的首次交卷成绩比较；按规则生成的试卷不展示 */
  private async findPercentile(session: PracticeSession): Promise<PercentileDto | null> {
    if (session.mode !== PracticeMode.MOCK || !session.paperId || session.score === null || session.pendingGrading) {
      return null;
    }
    const paper = await this.papersService.findById(session.paperId);
    if (paper.type === PaperType.GENERATED) {
      return null;
    }
    const sample = await this.practiceSessionRepository.findPercentileSample(session, session.score);
    return { beatRatio: sample.total === 0 ? null : ratio(sample.below, sample.total), sampleSize: sample.total };
  }
}
