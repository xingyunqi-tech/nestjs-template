// 需在独立的测试数据库上运行：会注册测试用户并写入考试、科目与知识点
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { KnowledgePointQuestionCountService } from '../../src/modules/exams/knowledge-point-question-count.service';

process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; id: number; email: string };
type Node = { id: string; parentId: string | null; level: number; path: string; isLeaf: boolean; children: Node[] };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `exams.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Exams', lastName: 'E2E' })
    .expect(200);
  const { body } = await api(app)
    .post('/api/v1/auth/email/login')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password })
    .expect(200);
  return { token: body.data.token as string, id: Number(body.data.user.id), email };
}

async function setRole(app: NestExpressApplication, email: string, role: RoleEnum): Promise<void> {
  const usersService = app.get(UsersService);
  const found = await usersService.findByEmail(email);
  if (found) {
    await usersService.update(found.id, { role: { id: role } });
  }
}

function findNode(nodes: Node[], id: string): Node | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

describe('Exam catalog', () => {
  let app: NestExpressApplication;
  let admin: Account;
  let user: Account;
  const examIds: string[] = [];
  const subjectIds: string[] = [];

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

  async function createExam(name: string, publish = true): Promise<string> {
    const { body } = await as(admin).post('/admin/exams', { name, category: 'CIVIL_SERVICE' }).expect(200);
    examIds.push(body.data.id);
    if (publish) {
      await as(admin).post(`/admin/exams/${body.data.id}/publish`).expect(200);
    }
    return body.data.id as string;
  }

  async function createSubject(examId: string, publish = true): Promise<string> {
    const { body } = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectIds.push(body.data.id);
    if (publish) {
      await as(admin).post(`/admin/subjects/${body.data.id}/publish`).expect(200);
    }
    return body.data.id as string;
  }

  async function createPoint(subjectId: string, parentId: string | null, name: string): Promise<string> {
    const { body } = await as(admin).post('/admin/knowledge-points', { subjectId, parentId, name }).expect(200);
    return body.data.id as string;
  }

  async function adminTree(subjectId: string): Promise<Node[]> {
    const { body } = await as(admin).get(`/admin/subjects/${subjectId}/knowledge-points`).expect(200);
    return body.data as Node[];
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);
  }, 120_000);

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      if (subjectIds.length > 0) {
        for (const level of [3, 2, 1]) {
          await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = ANY($1) AND "level" = $2`, [
            subjectIds,
            level,
          ]);
        }
        await dataSource.query(`DELETE FROM "subject" WHERE "id" = ANY($1)`, [subjectIds]);
      }
      if (examIds.length > 0) {
        await dataSource.query(`DELETE FROM "user_exam_profile" WHERE "examId" = ANY($1)`, [examIds]);
        await dataSource.query(`DELETE FROM "exam" WHERE "id" = ANY($1)`, [examIds]);
      }
      await setRole(app, admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  describe('admin permissions', () => {
    it('should reject users without content:manage', async () => {
      await as(user).get('/admin/exams').expect(403);
      await as(user).post('/admin/knowledge-points', {}).expect(403);
      await as(null).get('/admin/subjects').expect(401);
    });
  });

  describe('exams and subjects', () => {
    it('should list only published exams grouped by category', async () => {
      const examId = await createExam('E2E 草稿考试', false);
      const hasExam = async (): Promise<boolean> => {
        const { body } = await as(null).get('/exams').expect(200);
        const group = (body.data as { category: string; exams: { id: string }[] }[]).find(
          (g) => g.category === 'CIVIL_SERVICE',
        );
        return !!group?.exams.some((exam) => exam.id === examId);
      };

      expect(await hasExam()).toBe(false);
      await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
      expect(await hasExam()).toBe(true);
      await as(admin).post(`/admin/exams/${examId}/offline`).expect(200);
      expect(await hasExam()).toBe(false);
      await as(null).get(`/exams/${examId}/subjects`).expect(404);
    });

    it('should hide unpublished and offline subjects', async () => {
      const examId = await createExam('E2E 科目考试');
      const subjectId = await createSubject(examId, false);
      const visible = async (): Promise<boolean> => {
        const { body } = await as(null).get(`/exams/${examId}/subjects`).expect(200);
        return (body.data as { id: string }[]).some((subject) => subject.id === subjectId);
      };

      expect(await visible()).toBe(false);
      await as(null).get(`/subjects/${subjectId}/knowledge-points`).expect(404);
      await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
      expect(await visible()).toBe(true);
      await as(admin).post(`/admin/subjects/${subjectId}/offline`).expect(200);
      expect(await visible()).toBe(false);
    });

    it('should reject taking a draft offline and deleting published or non-empty exams', async () => {
      const draftId = await createExam('E2E 删除考试', false);
      await as(admin).post(`/admin/exams/${draftId}/offline`).expect(409);
      await createSubject(draftId, false);
      await as(admin).delete(`/admin/exams/${draftId}`).expect(409);

      const publishedId = await createExam('E2E 已发布考试');
      await as(admin).delete(`/admin/exams/${publishedId}`).expect(409);

      const emptyId = await createExam('E2E 空草稿', false);
      await as(admin).delete(`/admin/exams/${emptyId}`).expect(200);
      await as(admin).get(`/admin/exams/${emptyId}`).expect(404);
    });

    it('should filter admin lists by keyword and status', async () => {
      const examId = await createExam(`E2E 筛选_${Date.now()}`, false);
      const { body } = await as(admin).get('/admin/exams').query({ keyword: 'E2E 筛选_', status: 'DRAFT' }).expect(200);
      expect((body.data.list as { id: string }[]).map((exam) => exam.id)).toContain(examId);
      expect((body.data.list as { status: string }[]).every((exam) => exam.status === 'DRAFT')).toBe(true);
    });
  });

  describe('knowledge point tree', () => {
    let subjectId: string;

    beforeAll(async () => {
      subjectId = await createSubject(await createExam('E2E 知识点考试'));
    });

    it('should limit the tree to three levels and maintain path and isLeaf', async () => {
      const a = await createPoint(subjectId, null, 'A');
      const a1 = await createPoint(subjectId, a, 'A1');
      const a1x = await createPoint(subjectId, a1, 'A1x');
      await as(admin)
        .post('/admin/knowledge-points', { subjectId, parentId: a1x, name: 'too deep' })
        .expect(422)
        .expect(({ body }) => expect(body.data.parentId).toBeDefined());

      const tree = await adminTree(subjectId);
      expect(findNode(tree, a)).toMatchObject({ level: 1, isLeaf: false, path: `/${a}/` });
      expect(findNode(tree, a1x)).toMatchObject({ level: 3, isLeaf: true, path: `/${a}/${a1}/${a1x}/` });
    });

    it('should return the public tree for guests and users with empty progress', async () => {
      const guest = await as(null).get(`/subjects/${subjectId}/knowledge-points`).expect(200);
      const member = await as(user).get(`/subjects/${subjectId}/knowledge-points`).expect(200);
      expect(member.body.data).toEqual(guest.body.data);
      expect(guest.body.data[0]).toMatchObject({ level: 1, progress: null });
    });

    it('should move a subtree and update levels, paths and leaf flags', async () => {
      const root = await createPoint(subjectId, null, 'Root');
      const child = await createPoint(subjectId, root, 'Child');
      const grandchild = await createPoint(subjectId, child, 'Grandchild');

      await as(admin).post(`/admin/knowledge-points/${root}/move`, { parentId: grandchild }).expect(422);
      await as(admin).post(`/admin/knowledge-points/${child}/move`, { parentId: null, sort: 9 }).expect(200);

      const tree = await adminTree(subjectId);
      expect(findNode(tree, root)).toMatchObject({ isLeaf: true });
      expect(findNode(tree, child)).toMatchObject({ level: 1, parentId: null, path: `/${child}/` });
      expect(findNode(tree, grandchild)).toMatchObject({ level: 2, path: `/${child}/${grandchild}/` });

      const other = await createPoint(subjectId, null, 'Other');
      const otherChild = await createPoint(subjectId, other, 'OtherChild');
      await as(admin).post(`/admin/knowledge-points/${child}/move`, { parentId: otherChild }).expect(422);
      await as(admin).post(`/admin/knowledge-points/${child}/move`, { parentId: other }).expect(200);
      expect(findNode(await adminTree(subjectId), grandchild)).toMatchObject({
        level: 3,
        path: `/${other}/${child}/${grandchild}/`,
      });
    });

    it('should reject children, moves into and deletion of nodes with questions', async () => {
      const tagged = await createPoint(subjectId, null, 'Tagged');
      const loose = await createPoint(subjectId, null, 'Loose');
      const counter = app.get(KnowledgePointQuestionCountService);
      await counter.adjust([{ knowledgePointId: tagged, delta: 2 }]);
      try {
        await as(admin).post('/admin/knowledge-points', { subjectId, parentId: tagged, name: 'X' }).expect(409);
        await as(admin).post(`/admin/knowledge-points/${loose}/move`, { parentId: tagged }).expect(409);
        await as(admin).delete(`/admin/knowledge-points/${tagged}`).expect(409);
      } finally {
        await counter.adjust([{ knowledgePointId: tagged, delta: -2 }]);
      }
      await as(admin).delete(`/admin/knowledge-points/${tagged}`).expect(200);
    });

    it('should reject deleting a node with children and restore the parent leaf flag', async () => {
      const parent = await createPoint(subjectId, null, 'Parent');
      const child = await createPoint(subjectId, parent, 'Child');

      await as(admin).delete(`/admin/knowledge-points/${parent}`).expect(409);
      await as(admin).delete(`/admin/knowledge-points/${child}`).expect(200);
      expect(findNode(await adminTree(subjectId), parent)).toMatchObject({ isLeaf: true });
    });

    it('should rename and reorder a node', async () => {
      const id = await createPoint(subjectId, null, 'Old');
      const { body } = await as(admin).patch(`/admin/knowledge-points/${id}`, { name: 'New', sort: 5 }).expect(200);
      expect(body.data).toMatchObject({ name: 'New', sort: 5 });
    });

    it('should validate the migration target', async () => {
      const source = await createPoint(subjectId, null, 'Source');
      const branch = await createPoint(subjectId, null, 'Branch');
      const leaf = await createPoint(subjectId, branch, 'Leaf');

      await as(admin).post(`/admin/knowledge-points/${source}/migrate-questions`, { targetId: branch }).expect(422);
      await as(admin).post(`/admin/knowledge-points/${source}/migrate-questions`, { targetId: source }).expect(422);
      const { body } = await as(admin)
        .post(`/admin/knowledge-points/${source}/migrate-questions`, { targetId: leaf })
        .expect(200);
      expect(body.data).toMatchObject({ migrated: 0, source: { id: source }, target: { id: leaf } });
    });

    it('should recount question counts from question links', async () => {
      const id = await createPoint(subjectId, null, 'Recount');
      const counter = app.get(KnowledgePointQuestionCountService);
      await counter.adjust([{ knowledgePointId: id, delta: 3 }]);

      await expect(counter.recount(subjectId)).resolves.toBe(1);
      expect(findNode(await adminTree(subjectId), id)).toMatchObject({ questionCount: 0 });
    });
  });

  describe('my exam profiles', () => {
    it('should keep exactly one current exam while following, switching and unfollowing', async () => {
      const member = await registerAndLogin(app);
      const examA = await createExam('E2E 目标考试 A');
      const examB = await createExam('E2E 目标考试 B');
      const draft = await createExam('E2E 目标草稿', false);

      await as(member).put(`/me/exam-profiles/${draft}`).expect(404);

      const first = await as(member).put(`/me/exam-profiles/${examA}`, { examDate: '2026-11-29' }).expect(200);
      expect(first.body.data).toMatchObject({ examId: examA, isCurrent: true, dailyGoal: 30, examDate: '2026-11-29' });

      const second = await as(member).put(`/me/exam-profiles/${examB}`, { dailyGoal: 50 }).expect(200);
      expect(second.body.data).toMatchObject({ examId: examB, isCurrent: false, dailyGoal: 50 });

      await as(member).post(`/me/exam-profiles/${examB}/current`).expect(200);
      const list = await as(member).get('/me/exam-profiles').expect(200);
      expect(list.body.data.map((p: { examId: string; isCurrent: boolean }) => [p.examId, p.isCurrent])).toEqual([
        [examB, true],
        [examA, false],
      ]);
      expect(list.body.data[0].exam).toMatchObject({ id: examB, name: 'E2E 目标考试 B' });

      await as(member).put(`/me/exam-profiles/${examA}`, { examDate: null }).expect(200);
      await as(member).delete(`/me/exam-profiles/${examB}`).expect(200);
      const after = await as(member).get('/me/exam-profiles').expect(200);
      expect(after.body.data).toHaveLength(1);
      expect(after.body.data[0]).toMatchObject({ examId: examA, isCurrent: true, examDate: null });

      await as(member).delete(`/me/exam-profiles/${examB}`).expect(404);
      await as(member).post(`/me/exam-profiles/${examB}/current`).expect(404);
    });

    it('should fall back only to a published exam when unfollowing the current exam', async () => {
      const member = await registerAndLogin(app);
      const older = await createExam('E2E 回退 已发布');
      const offline = await createExam('E2E 回退 已下架');
      const current = await createExam('E2E 回退 当前');
      for (const examId of [older, offline, current]) {
        await as(member).put(`/me/exam-profiles/${examId}`).expect(200);
      }
      await as(member).post(`/me/exam-profiles/${current}/current`).expect(200);
      await as(admin).post(`/admin/exams/${offline}/offline`).expect(200);

      await as(member).delete(`/me/exam-profiles/${current}`).expect(200);
      const afterFirst = await as(member).get('/me/exam-profiles').expect(200);
      expect(afterFirst.body.data.find((p: { isCurrent: boolean }) => p.isCurrent)).toMatchObject({ examId: older });

      await as(member).delete(`/me/exam-profiles/${older}`).expect(200);
      const afterSecond = await as(member).get('/me/exam-profiles').expect(200);
      expect(afterSecond.body.data).toHaveLength(1);
      expect(afterSecond.body.data[0]).toMatchObject({ examId: offline, isCurrent: false });
    });

    it('should keep a single current exam under concurrent first follows', async () => {
      const member = await registerAndLogin(app);
      const exams = await Promise.all([createExam('E2E 并发 1'), createExam('E2E 并发 2'), createExam('E2E 并发 3')]);

      await Promise.all(exams.map((examId) => as(member).put(`/me/exam-profiles/${examId}`).expect(200)));

      const { body } = await as(member).get('/me/exam-profiles').expect(200);
      expect(body.data).toHaveLength(3);
      expect(body.data.filter((p: { isCurrent: boolean }) => p.isCurrent)).toHaveLength(1);
    });

    it('should validate the request', async () => {
      const examId = await createExam('E2E 校验');
      await as(user).put(`/me/exam-profiles/${examId}`, { examDate: '2026-13-01' }).expect(422);
      await as(user).put(`/me/exam-profiles/${examId}`, { dailyGoal: 0 }).expect(422);
      await as(user)
        .put('/me/exam-profiles/not-a-uuid')
        .expect(400)
        .expect(({ body }) => expect(body.data).toEqual({ id: expect.any(String) }));
      await as(null).get('/me/exam-profiles').expect(401);
    });
  });
});
