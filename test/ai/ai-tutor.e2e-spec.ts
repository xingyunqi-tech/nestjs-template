// 需在独立的测试数据库与 Redis 上运行；LLM 与微信内容安全检测使用测试替身
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { MockInstance } from 'vitest';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { AppConfigService } from '../../src/modules/config/config.service';
import { StatsEventQueue } from '../../src/modules/study-stats/stats-event.queue';
import { WechatService } from '../../src/integrations/wechat/wechat.service';
import { LlmError, LlmProvider, LlmStreamChatParams, LlmStreamChunk } from '../../src/integrations/llm/llm-provider';
import { AlertReporter } from '../../src/infrastructure/alerting/alert-reporter';
import { AiRealtimeStore, aiMessageStreamKey } from '../../src/modules/ai/infrastructure/realtime/ai-realtime.store';
import { AiStaleMessageTask } from '../../src/modules/ai/ai-stale-message.task';
import { AiAccountCleaner } from '../../src/modules/ai/ai-account.cleaner';
import { FeedbacksAccountCleaner } from '../../src/modules/feedbacks/feedbacks-account.cleaner';
import { businessDate } from '../../src/modules/papers/domain/business-date';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };

type SseEvent = { id: string | null; event: string; data: Record<string, unknown> };

type LlmScript = (params: LlmStreamChatParams) => AsyncIterable<LlmStreamChunk>;

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

const FIRST_PART =
  '这道题考查的是基础常识，需要先回顾题干中给出的条件，再结合选项逐项分析，把与条件矛盾的选项依次排除，最后留下唯一符合的答案。\n\n';
const SECOND_PART = '因此正确答案是 B，选项 A 与 C 均与题干条件矛盾。';

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const fields = new Map<string, string>();
      for (const line of block.split('\n')) {
        const separator = line.indexOf(': ');
        fields.set(line.slice(0, separator), line.slice(separator + 2));
      }
      return {
        id: fields.get('id') ?? null,
        event: fields.get('event') ?? '',
        data: JSON.parse(fields.get('data') ?? '{}') as Record<string, unknown>,
      };
    });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function abortable(signal: AbortSignal | undefined, gate: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError('aborted', 'aborted'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new LlmError('aborted', 'aborted')), { once: true });
    void gate.then(resolve);
  });
}

async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('AI tutor', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  let subjectId: string;
  let pointId: string;
  let otherPointId: string;
  let questionId: string;
  let otherQuestionId: string;
  let mockPaperId: string;
  let llmScript: LlmScript;
  let config: Record<string, unknown>;
  let raiseAlert: MockInstance<AlertReporter['raise']>;
  const unique = `${Date.now()}`;
  const model = `e2e-model-${unique}`;
  const users: number[] = [];
  const sessionOf = new Map<string, string>();
  let seq = 0;

  let llmModel = model;
  const usage = (): LlmStreamChunk => ({
    type: 'usage',
    model: llmModel,
    inputTokens: 1000,
    outputTokens: 200,
    cachedInputTokens: 400,
  });

  const answerScript: LlmScript = async function* () {
    yield { type: 'answer', text: FIRST_PART };
    yield { type: 'answer', text: `${SECOND_PART}[[追问]]为什么不选 A？|如何快速排除？` };
    yield usage();
    yield { type: 'finish', finishReason: 'stop' };
  };

  const failingScript: LlmScript = async function* () {
    yield usage();
    throw new LlmError('upstreamError', 'upstream failed');
  };

  const gatedScript = (gate: Promise<void>, started: () => void): LlmScript =>
    async function* (params) {
      yield usage();
      yield { type: 'answer', text: FIRST_PART };
      started();
      await abortable(params.signal, gate);
      yield { type: 'answer', text: SECOND_PART };
      yield { type: 'finish', finishReason: 'stop' };
    };

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
      delete: (path: string) => withAuth(api(app).delete(`/api/v1${path}`)),
    };
  };

  const registerAndLogin = async (): Promise<Account> => {
    const email = `ai.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = md5('Secret00');
    await api(app)
      .post('/api/v1/auth/email/register')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password, firstName: 'Ai', lastName: 'E2E' })
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

  /** 已绑定微信、已同意 AI 服务声明，并在章节练习中作答该题 */
  const prepareLearner = async (): Promise<{ account: Account; sessionId: string }> => {
    const account = await registerAndLogin();
    await dataSource.query(`UPDATE "user" SET "wechatOpenId" = $1 WHERE "id" = $2`, [
      `e2e-ai-${unique}-${account.id}`,
      account.id,
    ]);
    await as(account).post('/me/consents', { type: 'AI_SERVICE', version: 'ai-v1' }).expect(200);
    const session = await as(account)
      .post('/practice/sessions', {
        mode: 'CHAPTER',
        subjectId,
        scope: { knowledgePointId: pointId },
        count: 10,
        deviceId: 'device-1',
      })
      .expect(200);
    const sessionId = session.body.data.id as string;
    await as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [
          { questionId, answer: { keys: ['A'] }, clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString() },
        ],
      })
      .expect(200);
    return { account, sessionId };
  };

  const createConversation = async (account: Account, sessionId?: string): Promise<string> => {
    const { body } = await as(account)
      .post('/ai/conversations', { contextType: 'QUESTION', contextId: questionId, sessionId })
      .expect(200);
    if (sessionId) {
      sessionOf.set(body.data.id as string, sessionId);
    }
    return body.data.id as string;
  };

  /** sessionId 缺省时携带创建会话时的练习会话，为 null 时不携带 */
  const send = (account: Account, conversationId: string, content = '为什么选 B？', sessionId?: string | null) =>
    as(account).post(`/ai/conversations/${conversationId}/messages`, {
      content,
      sessionId: sessionId === undefined ? sessionOf.get(conversationId) : (sessionId ?? undefined),
    });

  const sendAndRead = async (account: Account, conversationId: string, content?: string): Promise<SseEvent[]> => {
    const response = await send(account, conversationId, content);
    expect(response.status, response.text).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    return parseSse(response.text);
  };

  const quota = async (account: Account): Promise<{ used: number; remaining: number; limit: number }> =>
    (await as(account).get('/ai/quota').expect(200)).body.data.chat;

  const streamingMessageId = (conversationId: string): Promise<string> =>
    waitFor(async () => {
      const rows: { id: string }[] = await dataSource.query(
        `SELECT "id" FROM "ai_message" WHERE "conversationId" = $1 AND "role" = 'ASSISTANT' AND "status" = 'STREAMING'`,
        [conversationId],
      );
      return rows[0]?.id;
    });

  const messageStatus = async (messageId: string): Promise<string> =>
    (await dataSource.query(`SELECT "status" FROM "ai_message" WHERE "id" = $1`, [messageId]))[0]?.status as string;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin();
    await setRole(admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E AI 考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const createPoint = async (name: string): Promise<string> =>
      (await as(admin).post('/admin/knowledge-points', { subjectId, parentId: null, name }).expect(200)).body.data
        .id as string;
    pointId = await createPoint(`常识${unique}`);
    otherPointId = await createPoint(`言语${unique}`);
    const createQuestion = async (stem: string, knowledgePointId: string): Promise<string> => {
      const question = await as(admin)
        .post('/admin/questions', {
          subjectId,
          type: 'SINGLE',
          stem,
          options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
          answer: { keys: ['B'] },
          analysis: '解析',
          knowledgePointIds: [knowledgePointId],
        })
        .expect(200);
      const id = question.body.data.id as string;
      await as(admin).post(`/admin/questions/${id}/submit`).expect(200);
      await as(admin).post(`/admin/questions/${id}/publish`).expect(200);
      return id;
    };
    questionId = await createQuestion(`AI 讲题 ${unique}`, pointId);
    otherQuestionId = await createQuestion(`AI 其他题 ${unique}`, otherPointId);

    const paper = await as(admin)
      .post('/admin/papers', { subjectId, title: `AI 模考 ${unique}`, type: 'MOCK', durationMin: 60 })
      .expect(200);
    mockPaperId = paper.body.data.id;
    await as(admin)
      .put(`/admin/papers/${mockPaperId}/questions`, {
        sections: [{ title: '题目', questionType: 'SINGLE' }],
        questions: [{ questionId, sectionIndex: 0, score: 2 }],
      })
      .expect(200);
    await as(admin).post(`/admin/papers/${mockPaperId}/publish`).expect(200);
  }, 120_000);

  beforeEach(() => {
    config = {
      'consent.aiServiceVersion': 'ai-v1',
      'ai.enabled': true,
      'ai.quota.chat': 20,
      'ai.ratePerMinute': 10,
      'ai.dailyBudget': undefined,
    };
    const appConfig = app.get(AppConfigService);
    const getValue = appConfig.getValue.bind(appConfig);
    vi.spyOn(appConfig, 'getValue').mockImplementation((key) =>
      key in config ? Promise.resolve(config[key] as never) : getValue(key),
    );
    vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishSession').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishCheckIn').mockResolvedValue(undefined);

    vi.spyOn(app.get(WechatService), 'msgSecCheck').mockImplementation(({ content }) => {
      const pass = !content.includes('违规');
      return Promise.resolve({ pass, suggest: pass ? 'pass' : 'risky', label: pass ? 100 : 20001, traceId: 'e2e' });
    });
    llmScript = answerScript;
    llmModel = model;
    vi.spyOn(app.get(LlmProvider), 'streamChat').mockImplementation((params) => llmScript(params));

    const store = app.get(AiRealtimeStore);
    const incrementFloat = store.incrementFloat.bind(store);
    vi.spyOn(store, 'incrementFloat').mockImplementation((key, amount, ttl) =>
      key.startsWith('ai:cost:') ? Promise.resolve(amount) : incrementFloat(key, amount, ttl),
    );
    const increment = store.increment.bind(store);
    vi.spyOn(store, 'increment').mockImplementation((key, ttl) =>
      key.startsWith('ai:budget-alert:') ? Promise.resolve(1) : increment(key, ttl),
    );
    raiseAlert = vi.spyOn(app.get(AlertReporter), 'raise').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      if (users.length > 0) {
        await dataSource.query(`DELETE FROM "ai_conversation" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "feedback" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "user_consent" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`UPDATE "user" SET "wechatOpenId" = NULL WHERE "id" = ANY($1::int[])`, [users]);
      }
      await dataSource.query(`DELETE FROM "ai_usage_daily" WHERE "model" LIKE $1`, [`${model}%`]);
      if (subjectId) {
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "feedback" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "practice_session" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "user_daily_stat" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "wrong_question" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(
          `DELETE FROM "user_knowledge_stat" WHERE "knowledgePointId" IN
             (SELECT "id" FROM "knowledge_point" WHERE "subjectId" = $1)`,
          [subjectId],
        );
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1`, [subjectId]);
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

  describe('visibility', () => {
    it('should reject a conversation or a message with a session that does not contain the question', async () => {
      const { account, sessionId } = await prepareLearner();

      await as(account)
        .post('/ai/conversations', { contextType: 'QUESTION', contextId: otherQuestionId, sessionId })
        .expect(403)
        .expect(({ body }) => expect(body.data.errorKey).toBe('questionNotAccessible'));

      const conversationId = await createConversation(account, sessionId);
      const otherSession = await as(account)
        .post('/practice/sessions', {
          mode: 'CHAPTER',
          subjectId,
          scope: { knowledgePointId: otherPointId },
          count: 10,
          deviceId: 'device-1',
        })
        .expect(200);
      await send(account, conversationId, '为什么', otherSession.body.data.id as string)
        .expect(403)
        .expect(({ body }) => expect(body.data.errorKey).toBe('questionNotAccessible'));
      expect(await quota(account)).toMatchObject({ used: 0 });
    });

    it('should check the visibility on every message and hide the conversation while a mock contains the question', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      const events = await sendAndRead(account, conversationId);
      const messageId = events[0].data.messageId as string;
      expect(events.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'DONE' } });

      const mock = await as(account)
        .post('/practice/sessions', { mode: 'MOCK', subjectId, paperId: mockPaperId, deviceId: 'device-1' })
        .expect(200);
      expect(mock.body.data.id).toEqual(expect.any(String));

      const hidden = ({ body }: { body: { data: { errorKey: string; hiddenReason?: string } } }) =>
        expect(body.data.errorKey).toBe('answerHidden');
      await send(account, conversationId).expect(403).expect(hidden);
      await send(account, conversationId, '再讲一遍', null).expect(403).expect(hidden);
      await as(account)
        .get(`/ai/conversations/${conversationId}/messages`)
        .expect(403)
        .expect(({ body }) =>
          expect(body.data).toMatchObject({ errorKey: 'answerHidden', hiddenReason: 'mockInProgress' }),
        );
      await as(account).get(`/ai/messages/${messageId}`).expect(403).expect(hidden);
      await as(account).get(`/ai/messages/${messageId}/events`).expect(403).expect(hidden);
      await as(account).post(`/ai/messages/${messageId}/report`, { content: '有误' }).expect(403).expect(hidden);
      expect(await quota(account)).toMatchObject({ used: 1 });
      expect(app.get(LlmProvider).streamChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('quota and cost', () => {
    it('should consume the quota, refund upstream failures and reject once the quota is used up', async () => {
      config['ai.quota.chat'] = 2;
      llmModel = `${model}-quota`;
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);

      const done = await sendAndRead(account, conversationId);
      expect(done.map((event) => event.event)).toEqual([
        'message.start',
        'answer.delta',
        'answer.delta',
        'suggestions',
        'message.done',
      ]);
      expect(done[3].data).toEqual({ items: ['为什么不选 A？', '如何快速排除？'] });
      expect(await quota(account)).toEqual({ limit: 2, used: 1, remaining: 1 });

      await send(account, conversationId, '违规内容')
        .expect(422)
        .expect(({ body }) => expect(body.data.errorKey).toBe('contentBlocked'));
      expect(await quota(account)).toMatchObject({ used: 1 });

      llmScript = failingScript;
      const failed = await sendAndRead(account, conversationId);
      expect(failed.at(-1)).toMatchObject({ event: 'error', data: { code: 'aiGenerationFailed' } });
      expect(await messageStatus(failed[0].data.messageId as string)).toBe('FAILED');
      expect(await quota(account)).toMatchObject({ used: 1, remaining: 1 });

      llmScript = answerScript;
      await sendAndRead(account, conversationId);
      expect(await quota(account)).toEqual({ limit: 2, used: 2, remaining: 0 });
      await send(account, conversationId)
        .expect(429)
        .expect(({ body }) => expect(body.data.errorKey).toBe('aiQuotaExceeded'));

      const today = businessDate();
      await as(account).get(`/admin/ai/usage?from=${today}&to=${today}`).expect(403);
      const usageResponse = await as(admin).get(`/admin/ai/usage?from=${today}&to=${today}`).expect(200);
      const row = (usageResponse.body.data.items as { model: string }[]).find((item) => item.model === llmModel);
      expect(row).toMatchObject({
        date: today,
        kind: 'chat',
        requests: 3,
        failures: 1,
        inputTokens: 3000,
        cachedInputTokens: 1200,
      });
      expect(usageResponse.body.data.total.requests).toBeGreaterThanOrEqual(3);
      expect(usageResponse.body.data.total.cachedInputTokens).toBeGreaterThanOrEqual(1200);
      await as(admin).get(`/admin/ai/usage?from=${today}&to=2000-01-01`).expect(422);
    });

    it('should reject requests over the per-minute rate', async () => {
      config['ai.ratePerMinute'] = 1;
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      if (new Date().getSeconds() >= 55) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
      }

      await sendAndRead(account, conversationId);
      await send(account, conversationId)
        .expect(429)
        .expect(({ body }) => expect(body.data.errorKey).toBe('aiRateLimited'));
      expect(await quota(account)).toMatchObject({ used: 1 });
    });

    it('should answer aiUnavailable and raise an alert once the daily budget is reached', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      config['ai.dailyBudget'] = 0;

      await send(account, conversationId)
        .expect(503)
        .expect(({ body }) => expect(body.data.errorKey).toBe('aiUnavailable'));
      expect(await quota(account)).toMatchObject({ used: 0 });
      expect(raiseAlert).toHaveBeenCalledWith(
        'aiBudgetExceeded',
        'CRITICAL',
        expect.any(String),
        expect.objectContaining({ date: businessDate(), budget: 0 }),
        `aiBudgetExceeded:${businessDate()}`,
      );
      expect(app.get(LlmProvider).streamChat).not.toHaveBeenCalled();

      config['ai.dailyBudget'] = undefined;
      await sendAndRead(account, conversationId);
    });
  });

  describe('generation', () => {
    it('should save the delivered content as STOPPED when the user stops generating', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      const gate = deferred();
      const started = deferred();
      llmScript = gatedScript(gate.promise, started.resolve);

      const pending = send(account, conversationId).then((response) => response);
      await started.promise;
      const messageId = await streamingMessageId(conversationId);
      await waitFor(async () => (await as(account).get(`/ai/messages/${messageId}`)).body.data.content === FIRST_PART);
      await send(account, conversationId).expect(409);

      await as(account).post(`/ai/messages/${messageId}/stop`).expect(200);
      const events = parseSse((await pending).text);
      expect(events.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'STOPPED' } });

      const message = await as(account).get(`/ai/messages/${messageId}`).expect(200);
      expect(message.body.data).toMatchObject({ status: 'STOPPED', content: FIRST_PART });
      expect(await quota(account)).toMatchObject({ used: 1 });
      await as(account).post(`/ai/messages/${messageId}/stop`).expect(200);
      gate.resolve();
    });

    it('should keep generating after the client disconnects and resume from the last event', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      const gate = deferred();
      const started = deferred();
      llmScript = gatedScript(gate.promise, started.resolve);

      const connection = send(account, conversationId);
      connection.end(() => undefined);
      await started.promise;
      const messageId = await streamingMessageId(conversationId);
      const partial = await waitFor(async () => {
        const { body } = await as(account).get(`/ai/messages/${messageId}`).expect(200);
        return body.data.content === FIRST_PART ? body.data : null;
      });
      connection.abort();
      expect(partial).toMatchObject({ status: 'STREAMING', lastEventId: expect.any(String) });

      gate.resolve();
      const resumed = await as(account)
        .get(`/ai/messages/${messageId}/events?after=${partial.lastEventId}`)
        .expect(200);
      const events = parseSse(resumed.text);
      expect(events.map((event) => event.event)).toEqual(['answer.delta', 'message.done']);
      expect(events[0].data).toEqual({ text: SECOND_PART });

      const message = await as(account).get(`/ai/messages/${messageId}`).expect(200);
      expect(message.body.data).toMatchObject({
        status: 'DONE',
        content: `${FIRST_PART}${SECOND_PART}`,
        lastEventId: null,
      });
      const replay = parseSse((await as(account).get(`/ai/messages/${messageId}/events`).expect(200)).text);
      expect(replay[0]).toMatchObject({ event: 'message.start', data: { messageId } });
      expect(replay.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'DONE' } });
    });

    it('should fail a stale streaming message and refund the quota only once', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      const gate = deferred();
      const started = deferred();
      llmScript = gatedScript(gate.promise, started.resolve);

      const pending = send(account, conversationId).then((response) => response);
      await started.promise;
      const messageId = await streamingMessageId(conversationId);
      expect(await quota(account)).toMatchObject({ used: 1 });
      await dataSource.query(`UPDATE "ai_message" SET "createdAt" = now() - interval '6 minutes' WHERE "id" = $1`, [
        messageId,
      ]);

      await app.get(AiStaleMessageTask).failStaleMessages(new Date());
      expect(await messageStatus(messageId)).toBe('FAILED');
      expect(await quota(account)).toMatchObject({ used: 0 });

      gate.resolve();
      const events = parseSse((await pending).text);
      expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'aiGenerationFailed' } });
      const store = app.get(AiRealtimeStore);
      await waitFor(async () =>
        (await store.read(aiMessageStreamKey(messageId), '0', 100))?.some(
          (entry) => entry.data.code === 'aiGenerationInterrupted',
        ),
      );
      expect(await messageStatus(messageId)).toBe('FAILED');
      expect(await quota(account)).toMatchObject({ used: 0 });
    });
  });

  describe('feedback and report', () => {
    it('should like, change and withdraw the feedback of an own answer only', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      const events = await sendAndRead(account, conversationId);
      const messageId = events[0].data.messageId as string;
      const feedbackOf = async (): Promise<unknown> =>
        (await as(account).get(`/ai/messages/${messageId}`).expect(200)).body.data.feedback;

      await as(account).post(`/ai/messages/${messageId}/feedback`, { feedback: 'LIKE' }).expect(200);
      expect(await feedbackOf()).toBe('LIKE');
      await as(account).post(`/ai/messages/${messageId}/feedback`, { feedback: 'DISLIKE' }).expect(200);
      expect(await feedbackOf()).toBe('DISLIKE');
      await as(account).post(`/ai/messages/${messageId}/feedback`, { feedback: null }).expect(200);
      expect(await feedbackOf()).toBeNull();
      await as(account).post(`/ai/messages/${messageId}/feedback`, {}).expect(422);
      await as(account).post(`/ai/messages/${messageId}/feedback`, { feedback: 'LOVE' }).expect(422);

      const [userMessage] = await dataSource.query(
        `SELECT "id" FROM "ai_message" WHERE "conversationId" = $1 AND "role" = 'USER'`,
        [conversationId],
      );
      await as(account).post(`/ai/messages/${userMessage.id}/feedback`, { feedback: 'LIKE' }).expect(404);
      const stranger = await registerAndLogin();
      await as(stranger).post(`/ai/messages/${messageId}/feedback`, { feedback: 'LIKE' }).expect(404);
      await as(stranger).post(`/ai/messages/${messageId}/report`, {}).expect(404);
    });

    it('should report an answer once as ai_content, hide it from the general feedback endpoints and keep the anonymized snapshot after the account cleanup', async () => {
      const { account, sessionId } = await prepareLearner();
      const conversationId = await createConversation(account, sessionId);
      const events = await sendAndRead(account, conversationId);
      const messageId = events[0].data.messageId as string;

      const report = await as(account).post(`/ai/messages/${messageId}/report`, { content: '讲解有误' }).expect(200);
      expect(report.body.data).toMatchObject({
        type: 'ai_content',
        content: '讲解有误',
        messageId,
        questionId,
        messageSnapshot: { content: `${FIRST_PART}${SECOND_PART}`, status: 'DONE' },
      });

      const again = await as(account).post(`/ai/messages/${messageId}/report`, { content: '再次举报' }).expect(200);
      expect(again.body.data).toMatchObject({ id: report.body.data.id, content: '讲解有误' });

      const list = await as(admin).get(`/admin/question-reports?type=ai_content&questionId=${questionId}`).expect(200);
      expect(list.body.data.list.filter((item: { messageId: string }) => item.messageId === messageId)).toEqual([
        expect.objectContaining({ id: report.body.data.id }),
      ]);

      await as(account).get('/feedbacks?type=ai_content').expect(422);
      await as(account).get(`/feedbacks/${report.body.data.id}`).expect(404);
      const general = await as(account).get('/feedbacks').expect(200);
      expect(general.body.data.list).toEqual([]);

      await app.get(AiAccountCleaner).clean(account.id);
      await app.get(FeedbacksAccountCleaner).clean(account.id);
      const remaining = await dataSource.query(
        `SELECT count(*)::int AS "n" FROM "ai_conversation" WHERE "userId" = $1`,
        [account.id],
      );
      expect(remaining[0].n).toBe(0);
      expect(await messageStatus(messageId)).toBeUndefined();
      expect(await quota(account)).toMatchObject({ used: 0 });
      const [kept] = await dataSource.query(`SELECT "userId", "messageSnapshot" FROM "feedback" WHERE "id" = $1`, [
        report.body.data.id,
      ]);
      expect(kept.userId).toBeNull();
      expect(kept.messageSnapshot).toMatchObject({ content: `${FIRST_PART}${SECOND_PART}`, status: 'DONE' });
    });
  });
});
