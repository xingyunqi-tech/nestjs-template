// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、试卷、练习会话、学习统计、纠错单与勘误任务
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { MockInstance } from 'vitest';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { StatsEventQueue } from '../../src/modules/study-stats/stats-event.queue';
import { StatsEventService } from '../../src/modules/study-stats/stats-event.service';
import { MockSubmitScheduler } from '../../src/modules/practice/mock-submit.scheduler';
import { ErrataQueue } from '../../src/modules/errata/errata.queue';
import { ErrataService } from '../../src/modules/errata/errata.service';
import { AnswerRegradeService } from '../../src/modules/practice/answer-regrade.service';
import { LearningStatsRepository } from '../../src/modules/study-stats/infrastructure/persistence/learning-stats.repository';
import { WrongQuestionRepository } from '../../src/modules/wrong-book/infrastructure/persistence/wrong-question.repository';
import { TransactionHandle, createTransactionHandle } from '../../src/common/database/transaction-handle';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type Target = { questionId: string; leafId: string };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

describe('Question errata', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  let subjectId: string;
  let branchId: string;
  let publishErrata: MockInstance<ErrataQueue['publish']>;
  const users: number[] = [];
  const unique = `${Date.now()}`;
  let seq = 0;

  const as = (account: Account | null) => {
    const withAuth = (req: request.Test): request.Test => {
      req.set('X-Forwarded-For', randomIp());
      return account ? req.set('Authorization', `Bearer ${account.token}`) : req;
    };
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
      patch: (path: string, body?: object) => withAuth(api(app).patch(`/api/v1${path}`)).send(body ?? {}),
    };
  };

  const registerAndLogin = async (): Promise<Account> => {
    const email = `errata.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = md5('Secret00');
    await api(app)
      .post('/api/v1/auth/email/register')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password, firstName: 'Errata', lastName: 'E2E' })
      .expect(200);
    const { body } = await api(app)
      .post('/api/v1/auth/email/login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password })
      .expect(200);
    const account = { token: body.data.token as string, email, id: Number(body.data.user.id) };
    users.push(account.id);
    return account;
  };

  const setRole = async (email: string, role: RoleEnum): Promise<void> => {
    const usersService = app.get(UsersService);
    const found = await usersService.findByEmail(email);
    if (found) {
      await usersService.update(found.id, { role: { id: role } });
    }
  };

  /** 每道题单独挂一个叶子知识点，章节练习只抽到这一题 */
  const newQuestion = async (name: string, content: object = {}): Promise<Target> => {
    const leaf = await as(admin)
      .post('/admin/knowledge-points', { subjectId, parentId: branchId, name: `${name}${seq++}` })
      .expect(200);
    const leafId = leaf.body.data.id as string;
    const { body } = await as(admin)
      .post('/admin/questions', {
        subjectId,
        type: 'SINGLE',
        stem: `${name} ${unique}`,
        options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
        answer: { keys: ['B'] },
        analysis: `${name}解析`,
        knowledgePointIds: [leafId],
        ...content,
      })
      .expect(200);
    const questionId = body.data.id as string;
    await as(admin).post(`/admin/questions/${questionId}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${questionId}/publish`).expect(200);
    return { questionId, leafId };
  };

  /** 章节练习作答并计入统计，返回会话与记录 */
  const answerAndApply = async (
    account: Account,
    target: Target,
    key: string,
  ): Promise<{ sessionId: string; recordId: string }> => {
    const session = await as(account)
      .post('/practice/sessions', {
        mode: 'CHAPTER',
        subjectId,
        scope: { knowledgePointId: target.leafId },
        count: 10,
        deviceId: 'device-1',
      })
      .expect(200);
    const sessionId = session.body.data.id as string;
    await as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [
          {
            questionId: target.questionId,
            answer: { keys: [key] },
            clientSeq: (seq += 1),
            clientAnsweredAt: new Date().toISOString(),
          },
        ],
      })
      .expect(200);
    const [{ id: recordId }] = await dataSource.query(
      `SELECT "id" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`,
      [sessionId, target.questionId],
    );
    await expect(app.get(StatsEventService).applyRecord(recordId)).resolves.toBe(true);
    return { sessionId, recordId };
  };

  /** 单题试卷开考并作答，返回会话 */
  const startMockWith = async (
    account: Account,
    questionId: string,
    score: number,
    answer: object,
  ): Promise<string> => {
    const paper = await as(admin)
      .post('/admin/papers', { subjectId, title: `勘误模考 ${seq++} ${unique}`, type: 'MOCK', durationMin: 60 })
      .expect(200);
    const paperId = paper.body.data.id as string;
    await as(admin)
      .put(`/admin/papers/${paperId}/questions`, {
        sections: [{ title: '题目', questionType: 'SINGLE' }],
        questions: [{ questionId, sectionIndex: 0, score }],
      })
      .expect(200);
    await as(admin).post(`/admin/papers/${paperId}/publish`).expect(200);
    const mock = await as(account)
      .post('/practice/sessions', { mode: 'MOCK', subjectId, paperId, deviceId: 'device-1' })
      .expect(200);
    const sessionId = mock.body.data.id as string;
    await as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [{ questionId, answer, clientSeq: 1, clientAnsweredAt: new Date().toISOString() }],
      })
      .expect(200);
    return sessionId;
  };

  const recordOf = async (sessionId: string, questionId: string): Promise<string> =>
    (
      await dataSource.query(`SELECT "id" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`, [
        sessionId,
        questionId,
      ])
    )[0].id as string;

  const createErrata = (questionId: string, body: object) =>
    as(admin).post(`/admin/questions/${questionId}/errata`, body);

  const runErrata = (id: string) => app.get(ErrataService).execute(id);

  const record = async (id: string) =>
    (
      await dataSource.query(
        `SELECT "isCorrect", "isPartial", "score"::float8 AS "score", "questionVersion", "gradedAt"
         FROM "answer_record" WHERE "id" = $1`,
        [id],
      )
    )[0] as { isCorrect: boolean; isPartial: boolean; score: number | null; questionVersion: number; gradedAt: Date };

  const session = async (id: string) =>
    (
      await dataSource.query(
        `SELECT "correctCount", "score"::float8 AS "score", "questionVersions" FROM "practice_session" WHERE "id" = $1`,
        [id],
      )
    )[0] as { correctCount: number; score: number | null; questionVersions: Record<string, number> };

  const questionStats = async (questionId: string) =>
    (
      await dataSource.query(`SELECT "statAnswered", "statCorrect", "currentVersion" FROM "question" WHERE "id" = $1`, [
        questionId,
      ])
    )[0] as { statAnswered: number; statCorrect: number; currentVersion: number };

  const wrongQuestion = async (account: Account, questionId: string) =>
    (
      await dataSource.query(
        `SELECT "wrongCount", "status", "firstWrongAt", "lastWrongAnswer", "consecutiveCorrect" FROM "wrong_question"
         WHERE "userId" = $1 AND "questionId" = $2`,
        [account.id, questionId],
      )
    )[0] as
      | { wrongCount: number; status: string; firstWrongAt: Date; lastWrongAnswer: unknown; consecutiveCorrect: number }
      | undefined;

  const knowledgeStat = async (account: Account, leafId: string) =>
    (
      await dataSource.query(
        `SELECT "answered", "correct", "recentResults" FROM "user_knowledge_stat"
         WHERE "userId" = $1 AND "knowledgePointId" = $2`,
        [account.id, leafId],
      )
    )[0] as { answered: number; correct: number; recentResults: number[] } | undefined;

  const dailyCorrect = async (account: Account): Promise<number> =>
    (
      await dataSource.query(
        `SELECT COALESCE(sum("correct"), 0)::int AS "correct" FROM "user_daily_stat"
         WHERE "userId" = $1 AND "subjectId" = $2`,
        [account.id, subjectId],
      )
    )[0].correct as number;

  const studyNotifications = (account: Account) =>
    dataSource.query<{ metadata: Record<string, unknown> }[]>(
      `SELECT "metadata" FROM "notification" WHERE "userId" = $1 AND "category" = 'STUDY'`,
      [account.id],
    );

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin();
    await setRole(admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 勘误考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    branchId = (
      await as(admin).post('/admin/knowledge-points', { subjectId, parentId: null, name: '常识' }).expect(200)
    ).body.data.id;
  }, 120_000);

  beforeEach(() => {
    vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishSession').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishCheckIn').mockResolvedValue(undefined);
    vi.spyOn(app.get(MockSubmitScheduler), 'schedule').mockResolvedValue(undefined);
    publishErrata = vi.spyOn(app.get(ErrataQueue), 'publish').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      if (users.length > 0) {
        await dataSource.query(`DELETE FROM "notification" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "feedback" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "study_checkin" WHERE "userId" = ANY($1::int[])`, [users]);
      }
      if (subjectId) {
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "feedback" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "errata" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "practice_session" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "user_daily_stat" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "wrong_question" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(
          `DELETE FROM "user_knowledge_stat" WHERE "knowledgePointId" IN
             (SELECT "id" FROM "knowledge_point" WHERE "subjectId" = $1)`,
          [subjectId],
        );
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        for (const level of [3, 2, 1]) {
          await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1 AND "level" = $2`, [
            subjectId,
            level,
          ]);
        }
        await dataSource.query(`DELETE FROM "subject" WHERE "id" = $1`, [subjectId]);
      }
      if (examId) {
        await dataSource.query(`DELETE FROM "user_exam_profile" WHERE "examId" = $1`, [examId]);
        await dataSource.query(`DELETE FROM "exam" WHERE "id" = $1`, [examId]);
      }
      await setRole(admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  describe('question reports', () => {
    it('should let a user report an associated question and see the handling result', async () => {
      const user = await registerAndLogin();
      const stranger = await registerAndLogin();
      const target = await newQuestion('纠错');
      await answerAndApply(user, target, 'A');

      await as(stranger)
        .post(`/questions/${target.questionId}/reports`, { reason: 'answer_wrong', content: '答案应为 A' })
        .expect(403)
        .expect(({ body }) => expect(body.data.errorKey).toBe('questionNotAccessible'));
      await as(user).post(`/questions/${target.questionId}/reports`, { reason: 'other' }).expect(422);
      const created = await as(user)
        .post(`/questions/${target.questionId}/reports`, { reason: 'answer_wrong', content: '答案应为 A' })
        .expect(200);
      expect(created.body.data).toMatchObject({
        type: 'question_error',
        status: 'pending',
        questionId: target.questionId,
        questionVersion: 1,
        reason: 'answer_wrong',
      });
      const reportId = created.body.data.id as number;

      await as(user).get('/admin/question-reports').expect(403);
      const list = await as(admin)
        .get(`/admin/question-reports?type=question_error&status=pending&questionId=${target.questionId}`)
        .expect(200);
      expect(list.body.data.list).toEqual([
        expect.objectContaining({ id: reportId, question: expect.objectContaining({ id: target.questionId }) }),
      ]);
      const detail = await as(admin).get(`/admin/question-reports/${reportId}`).expect(200);
      expect(detail.body.data).toMatchObject({ id: reportId, errata: null, question: { type: 'SINGLE' } });

      await as(admin)
        .patch(`/admin/question-reports/${reportId}`, { status: 'closed', reply: '经核对答案无误' })
        .expect(200);
      const mine = await as(user).get('/me/question-reports').expect(200);
      expect(mine.body.data.list).toEqual([
        expect.objectContaining({
          id: reportId,
          status: 'closed',
          reply: '经核对答案无误',
          question: expect.objectContaining({ id: target.questionId }),
        }),
      ]);
      expect(mine.body.data.list[0].question).not.toHaveProperty('answer');
      const general = await as(user).get('/feedbacks').expect(200);
      expect(general.body.data.list).toEqual([]);
      const filtered = await as(user).get('/feedbacks?type=question_error').expect(200);
      expect(filtered.body.data.list).toEqual([expect.objectContaining({ id: reportId })]);
    }, 60_000);
  });

  describe('errata', () => {
    it('should regrade a wrong answer as correct and remove it from the wrong book', async () => {
      const user = await registerAndLogin();
      const target = await newQuestion('判错改判对');
      const { sessionId, recordId } = await answerAndApply(user, target, 'A');
      const report = await as(user)
        .post(`/questions/${target.questionId}/reports`, { reason: 'answer_wrong', content: '答案应为 A' })
        .expect(200);
      expect(await wrongQuestion(user, target.questionId)).toMatchObject({ wrongCount: 1 });
      expect(await knowledgeStat(user, target.leafId)).toMatchObject({ answered: 1, correct: 0 });
      expect(await questionStats(target.questionId)).toMatchObject({ statAnswered: 1, statCorrect: 0 });
      const correctBefore = await dailyCorrect(user);

      const created = await createErrata(target.questionId, {
        answer: { keys: ['A'] },
        analysis: '勘误后解析',
        reportIds: [report.body.data.id],
      }).expect(200);
      expect(created.body.data).toMatchObject({ status: 'PENDING', fromVersion: 1, toVersion: 2 });
      expect(publishErrata).toHaveBeenCalledWith(created.body.data.id, false);
      const [version] = await dataSource.query(
        `SELECT "changeType", "answer", "analysis" FROM "question_version" WHERE "questionId" = $1 AND "version" = 2`,
        [target.questionId],
      );
      expect(version).toEqual({ changeType: 'ERRATA', answer: { keys: ['A'] }, analysis: '勘误后解析' });
      const linked = await as(admin).get(`/admin/question-reports/${report.body.data.id}`).expect(200);
      expect(linked.body.data).toMatchObject({ status: 'processing', errata: { id: created.body.data.id } });

      await runErrata(created.body.data.id);

      const progress = await as(admin).get(`/admin/errata/${created.body.data.id}`).expect(200);
      expect(progress.body.data).toMatchObject({ status: 'DONE', affectedUsers: 1, processedUsers: 1 });
      const list = await as(admin).get(`/admin/errata?questionId=${target.questionId}`).expect(200);
      expect(list.body.data.list).toEqual([expect.objectContaining({ id: created.body.data.id })]);
      expect(await record(recordId)).toMatchObject({ isCorrect: true, questionVersion: 2 });
      expect(await session(sessionId)).toMatchObject({ correctCount: 1 });
      expect(await wrongQuestion(user, target.questionId)).toBeUndefined();
      expect(await knowledgeStat(user, target.leafId)).toEqual({ answered: 1, correct: 1, recentResults: [1] });
      expect(await dailyCorrect(user)).toBe(correctBefore + 1);
      expect(await questionStats(target.questionId)).toMatchObject({
        statAnswered: 1,
        statCorrect: 1,
        currentVersion: 2,
      });
      expect(await studyNotifications(user)).toEqual([
        { metadata: { errataId: created.body.data.id, questionId: target.questionId } },
      ]);
      const mine = await as(user).get('/me/question-reports').expect(200);
      expect(mine.body.data.list[0]).toMatchObject({ status: 'resolved', reply: expect.any(String) });
    }, 60_000);

    it('should regrade a correct answer as wrong and add it to the wrong book', async () => {
      const user = await registerAndLogin();
      const target = await newQuestion('判对改判错');
      const { sessionId, recordId } = await answerAndApply(user, target, 'B');
      expect(await wrongQuestion(user, target.questionId)).toBeUndefined();
      expect(await questionStats(target.questionId)).toMatchObject({ statAnswered: 1, statCorrect: 1 });
      const correctBefore = await dailyCorrect(user);

      const created = await createErrata(target.questionId, { answer: { keys: ['C'] } }).expect(200);
      await runErrata(created.body.data.id);

      const regraded = await record(recordId);
      expect(regraded).toMatchObject({ isCorrect: false, questionVersion: 2 });
      expect(await session(sessionId)).toMatchObject({ correctCount: 0 });
      const wrong = await wrongQuestion(user, target.questionId);
      expect(wrong).toMatchObject({
        wrongCount: 1,
        status: 'ACTIVE',
        consecutiveCorrect: 0,
        lastWrongAnswer: { keys: ['B'] },
      });
      expect(new Date(wrong!.firstWrongAt).getTime()).toBe(new Date(regraded.gradedAt).getTime());
      expect(await knowledgeStat(user, target.leafId)).toEqual({ answered: 1, correct: 0, recentResults: [0] });
      expect(await dailyCorrect(user)).toBe(correctBefore - 1);
      expect(await questionStats(target.questionId)).toMatchObject({ statAnswered: 1, statCorrect: 0 });
    }, 60_000);

    it('should grade an ongoing mock by the corrected answer on submit', async () => {
      const user = await registerAndLogin();
      const target = await newQuestion('进行中模考');
      const paper = await as(admin)
        .post('/admin/papers', { subjectId, title: `勘误模考 ${unique}`, type: 'MOCK', durationMin: 60 })
        .expect(200);
      const paperId = paper.body.data.id as string;
      await as(admin)
        .put(`/admin/papers/${paperId}/questions`, {
          sections: [{ title: '单选', questionType: 'SINGLE' }],
          questions: [{ questionId: target.questionId, sectionIndex: 0, score: 2 }],
        })
        .expect(200);
      await as(admin).post(`/admin/papers/${paperId}/publish`).expect(200);
      const mock = await as(user)
        .post('/practice/sessions', { mode: 'MOCK', subjectId, paperId, deviceId: 'device-1' })
        .expect(200);
      const sessionId = mock.body.data.id as string;
      await as(user)
        .put(`/practice/sessions/${sessionId}/answers`, {
          deviceId: 'device-1',
          answers: [
            {
              questionId: target.questionId,
              answer: { keys: ['C'] },
              clientSeq: 1,
              clientAnsweredAt: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      const created = await createErrata(target.questionId, { answer: { keys: ['C'] } }).expect(200);

      const [paperQuestion] = await dataSource.query(
        `SELECT "questionVersion" FROM "paper_question" WHERE "paperId" = $1 AND "questionId" = $2`,
        [paperId, target.questionId],
      );
      expect(paperQuestion.questionVersion).toBe(2);
      expect((await session(sessionId)).questionVersions[target.questionId]).toBe(2);

      await as(user).post(`/practice/sessions/${sessionId}/submit`).expect(200);
      const [{ id: recordId }] = await dataSource.query(
        `SELECT "id" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`,
        [sessionId, target.questionId],
      );
      expect(await record(recordId)).toMatchObject({ isCorrect: true, score: 2 });
      expect(await session(sessionId)).toMatchObject({ correctCount: 1, score: 2 });

      await runErrata(created.body.data.id);
      expect(await record(recordId)).toMatchObject({ isCorrect: true, score: 2, questionVersion: 2 });
      expect(await session(sessionId)).toMatchObject({ correctCount: 1, score: 2 });
    }, 60_000);

    it('should keep the global contribution of a deleted account', async () => {
      const deleted = await registerAndLogin();
      const remaining = await registerAndLogin();
      const target = await newQuestion('注销贡献');
      await answerAndApply(deleted, target, 'A');
      const report = await as(deleted)
        .post(`/questions/${target.questionId}/reports`, { reason: 'answer_wrong', content: '答案应为 A' })
        .expect(200);
      await answerAndApply(remaining, target, 'A');
      expect(await questionStats(target.questionId)).toMatchObject({ statAnswered: 2, statCorrect: 0 });

      await dataSource.query(`DELETE FROM "session" WHERE "userId" = $1`, [deleted.id]);
      await dataSource.query(`DELETE FROM "user" WHERE "id" = $1`, [deleted.id]);
      const [orphan] = await dataSource.query(`SELECT "userId" FROM "feedback" WHERE "id" = $1`, [report.body.data.id]);
      expect(orphan.userId).toBeNull();

      const created = await createErrata(target.questionId, { answer: { keys: ['A'] } }).expect(200);
      await runErrata(created.body.data.id);

      expect(await questionStats(target.questionId)).toMatchObject({ statAnswered: 2, statCorrect: 1 });
      const progress = await as(admin).get(`/admin/errata/${created.body.data.id}`).expect(200);
      expect(progress.body.data).toMatchObject({ status: 'DONE', affectedUsers: 1, processedUsers: 1 });
    }, 60_000);

    it('should allow only one unfinished errata per question', async () => {
      const target = await newQuestion('并发勘误');

      const responses = await Promise.all([
        createErrata(target.questionId, { answer: { keys: ['A'] } }),
        createErrata(target.questionId, { answer: { keys: ['C'] } }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const rejected = responses.find((response) => response.status === 409)!;
      expect(rejected.body.data.errorKey).toBe('errataInProgress');
      expect(await questionStats(target.questionId)).toMatchObject({ currentVersion: 2 });
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "question_version" WHERE "questionId" = $1`,
        [target.questionId],
      );
      expect(count).toBe(2);

      await createErrata(target.questionId, { answer: { keys: ['B'] } })
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('errataInProgress'));
      const accepted = responses.find((response) => response.status === 200)!;
      await runErrata(accepted.body.data.id);
      await createErrata(target.questionId, { answer: { keys: ['B'] } }).expect(200);
    }, 60_000);
    it('should rescore a fill answer by blanks in a submitted mock', async () => {
      const user = await registerAndLogin();
      const target = await newQuestion('填空部分正确', {
        type: 'FILL',
        options: null,
        answer: { blanks: [['甲'], ['乙']] },
      });
      const sessionId = await startMockWith(user, target.questionId, 4, { blanks: ['甲', '丙'] });
      await as(user).post(`/practice/sessions/${sessionId}/submit`).expect(200);
      const recordId = await recordOf(sessionId, target.questionId);
      expect(await record(recordId)).toMatchObject({ isCorrect: false, score: 2 });

      const first = await createErrata(target.questionId, { answer: { blanks: [['甲'], ['丙', '丁']] } }).expect(200);
      await runErrata(first.body.data.id);
      expect(await record(recordId)).toMatchObject({ isCorrect: true, isPartial: false, score: 4, questionVersion: 2 });
      expect(await session(sessionId)).toMatchObject({ correctCount: 1, score: 4 });

      const second = await createErrata(target.questionId, { answer: { blanks: [['戊'], ['丙']] } }).expect(200);
      await runErrata(second.body.data.id);
      expect(await record(recordId)).toMatchObject({ isCorrect: false, score: 2, questionVersion: 3 });
      expect(await session(sessionId)).toMatchObject({ correctCount: 0, score: 2 });
    }, 60_000);

    it('should resume an interrupted errata from the next user through the retry endpoint', async () => {
      const first = await registerAndLogin();
      const second = await registerAndLogin();
      const target = await newQuestion('断点续跑');
      const { recordId: firstRecord } = await answerAndApply(first, target, 'A');
      const { recordId: secondRecord } = await answerAndApply(second, target, 'A');
      const created = await createErrata(target.questionId, { answer: { keys: ['A'] } }).expect(200);
      const errataId = created.body.data.id as string;
      const regrade = app.get(AnswerRegradeService);
      const original = regrade.regradeUser.bind(regrade);
      const failure = new Error('connection lost');
      vi.spyOn(regrade, 'regradeUser')
        .mockImplementationOnce(original)
        .mockImplementationOnce(() => Promise.reject(failure));

      await expect(runErrata(errataId)).rejects.toThrow('connection lost');
      const interrupted = await as(admin).get(`/admin/errata/${errataId}`).expect(200);
      expect(interrupted.body.data).toMatchObject({ status: 'RUNNING', affectedUsers: 2, processedUsers: 1 });
      expect(await record(firstRecord)).toMatchObject({ isCorrect: true });
      expect(await record(secondRecord)).toMatchObject({ isCorrect: false, questionVersion: 1 });

      await as(admin).post(`/admin/errata/${errataId}/retry`).expect(422);
      await app.get(ErrataService).markFailed(errataId, failure);
      const retried = await as(admin).post(`/admin/errata/${errataId}/retry`).expect(200);
      expect(retried.body.data).toMatchObject({ status: 'PENDING', failureReason: null });
      expect(publishErrata).toHaveBeenLastCalledWith(errataId, true);

      await runErrata(errataId);

      const progress = await as(admin).get(`/admin/errata/${errataId}`).expect(200);
      expect(progress.body.data).toMatchObject({ status: 'DONE', affectedUsers: 2, processedUsers: 2 });
      expect(await record(secondRecord)).toMatchObject({ isCorrect: true, questionVersion: 2 });
      expect(await questionStats(target.questionId)).toMatchObject({ statAnswered: 2, statCorrect: 2 });
      expect(await studyNotifications(first)).toHaveLength(1);
      expect(await studyNotifications(second)).toHaveLength(1);
    }, 60_000);

    it('should resume a pending errata without progress for too long through the retry endpoint', async () => {
      const target = await newQuestion('卡住任务');
      const created = await createErrata(target.questionId, { answer: { keys: ['A'] } }).expect(200);
      const errataId = created.body.data.id as string;
      await as(admin).post(`/admin/errata/${errataId}/retry`).expect(422);

      await dataSource.query(`UPDATE "errata" SET "updatedAt" = now() - interval '11 minutes' WHERE "id" = $1`, [
        errataId,
      ]);
      await as(admin).post(`/admin/errata/${errataId}/retry`).expect(200);
      expect(publishErrata).toHaveBeenLastCalledWith(errataId, true);

      await expect(app.get(ErrataService).resumeStale()).resolves.toBe(0);
      await runErrata(errataId);
      expect((await as(admin).get(`/admin/errata/${errataId}`).expect(200)).body.data.status).toBe('DONE');
    }, 60_000);
  });

  describe('stats rebuild', () => {
    const inTransaction = <T>(work: (handle: TransactionHandle) => Promise<T>): Promise<T> =>
      dataSource.transaction((manager) => work(createTransactionHandle(manager)));

    it('should rebuild knowledge stats and the wrong book from applied records', async () => {
      const user = await registerAndLogin();
      const target = await newQuestion('全量重建');
      for (let i = 0; i < 22; i += 1) {
        await answerAndApply(user, target, 'A');
      }
      const ids: string[] = (
        await dataSource.query(
          `SELECT "id" FROM "answer_record" WHERE "userId" = $1 AND "questionId" = $2 ORDER BY "createdAt", "id"`,
          [user.id, target.questionId],
        )
      ).map((row: { id: string }) => row.id);
      const base = new Date('2026-09-01T00:00:00Z').getTime();
      const pattern = ids.map((_, index) => index % 3 === 0);
      for (const [index, id] of ids.entries()) {
        await dataSource.query(
          `UPDATE "answer_record" SET "isCorrect" = $2, "statsAppliedAt" = $3, "gradedAt" = $4,
             "answer" = jsonb_build_object('keys', ARRAY['A'], 'seq', $5::int)
           WHERE "id" = $1`,
          [id, pattern[index], new Date(base + (ids.length - index) * 1000), new Date(base + index * 60_000), index],
        );
      }
      await dataSource.query(
        `UPDATE "user_knowledge_stat" SET "answered" = 99 WHERE "userId" = $1 AND "knowledgePointId" = $2`,
        [user.id, target.leafId],
      );
      await dataSource.query(
        `UPDATE "wrong_question" SET "status" = 'MASTERED', "consecutiveCorrect" = 2, "masteredAt" = now()
         WHERE "userId" = $1 AND "questionId" = $2`,
        [user.id, target.questionId],
      );

      await inTransaction((handle) =>
        app.get(LearningStatsRepository).rebuildKnowledgeStats(handle, user.id, target.questionId),
      );
      await inTransaction((handle) =>
        app.get(WrongQuestionRepository).rebuildFromRecords(handle, {
          userId: user.id,
          questionId: target.questionId,
          subjectId,
        }),
      );

      const byAppliedOrder = [...pattern].reverse();
      expect(await knowledgeStat(user, target.leafId)).toEqual({
        answered: 22,
        correct: pattern.filter(Boolean).length,
        recentResults: byAppliedOrder.slice(-20).map((value) => (value ? 1 : 0)),
      });
      const [{ lastAnsweredAt }] = await dataSource.query(
        `SELECT "lastAnsweredAt" FROM "user_knowledge_stat" WHERE "userId" = $1 AND "knowledgePointId" = $2`,
        [user.id, target.leafId],
      );
      expect(new Date(lastAnsweredAt).getTime()).toBe(base + 21 * 60_000);
      const wrongIndexes = pattern.flatMap((value, index) => (value ? [] : [index]));
      const [wrong] = await dataSource.query(
        `SELECT "wrongCount", "status", "consecutiveCorrect", "firstWrongAt", "lastWrongAt", "lastWrongAnswer"
         FROM "wrong_question" WHERE "userId" = $1 AND "questionId" = $2`,
        [user.id, target.questionId],
      );
      expect(wrong).toMatchObject({
        wrongCount: wrongIndexes.length,
        status: 'MASTERED',
        consecutiveCorrect: 2,
        lastWrongAnswer: { keys: ['A'], seq: wrongIndexes.at(-1) },
      });
      expect(new Date(wrong.firstWrongAt).getTime()).toBe(base + wrongIndexes[0] * 60_000);
      expect(new Date(wrong.lastWrongAt).getTime()).toBe(base + wrongIndexes.at(-1)! * 60_000);

      await dataSource.query(`UPDATE "answer_record" SET "isCorrect" = true WHERE "id" = ANY($1::uuid[])`, [ids]);
      await inTransaction((handle) =>
        app.get(WrongQuestionRepository).rebuildFromRecords(handle, {
          userId: user.id,
          questionId: target.questionId,
          subjectId,
        }),
      );
      expect(await wrongQuestion(user, target.questionId)).toBeUndefined();
    }, 120_000);
  });
});
