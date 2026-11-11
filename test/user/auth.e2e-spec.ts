import request from 'supertest';
import { APP_URL, TESTER_EMAIL, TESTER_PASSWORD, md5 } from '../utils/constants';

describe('Auth Module', () => {
  const app = APP_URL;
  const newUserFirstName = `Tester${Date.now()}`;
  const newUserLastName = `E2E`;
  const newUserEmail = `User.${Date.now()}@example.com`;
  const newUserPassword = md5('Secret00');

  describe('Registration', () => {
    it('should fail with exists email: /api/v1/auth/email/register (POST)', () => {
      return request(app)
        .post('/api/v1/auth/email/register')
        .send({
          email: TESTER_EMAIL,
          password: TESTER_PASSWORD,
          firstName: 'Tester',
          lastName: 'E2E',
        })
        .expect(422)
        .expect(({ body }) => {
          expect(body.data.email).toBeDefined();
        });
    });

    it('should successfully: /api/v1/auth/email/register (POST)', async () => {
      return request(app)
        .post('/api/v1/auth/email/register')
        .send({
          email: newUserEmail,
          password: newUserPassword,
          firstName: newUserFirstName,
          lastName: newUserLastName,
        })
        .expect(200);
    });

    describe('Login', () => {
      it('should successfully with unconfirmed email: /api/v1/auth/email/login (POST)', () => {
        return request(app)
          .post('/api/v1/auth/email/login')
          .send({ email: newUserEmail, password: newUserPassword })
          .expect(200)
          .expect(({ body }) => {
            expect(body.data.token).toBeDefined();
          });
      });
    });
  });

  describe('Login', () => {
    it('should successfully for user with confirmed email: /api/v1/auth/email/login (POST)', () => {
      return request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.token).toBeDefined();
          expect(body.data.refreshToken).toBeDefined();
          expect(body.data.tokenExpires).toBeDefined();
          expect(body.data.user.email).toBeDefined();
          expect(body.data.user.hash).not.toBeDefined();
          expect(body.data.user.password).not.toBeDefined();
        });
    });
  });

  describe('Logged in user', () => {
    let newUserApiToken: string;

    beforeAll(async () => {
      const response = await request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword });

      // Debug: log response if login fails
      if (response.status !== 200) {
        console.error('Login failed in beforeAll');
        console.error('Status:', response.status);
        console.error('Body:', JSON.stringify(response.body, null, 2));
      }

      // This will throw if status is not 200
      expect(response.status).toBe(200);

      if (!response.body.data?.token) {
        throw new Error(`Login failed in beforeAll. Response: ${JSON.stringify(response.body)}`);
      }

      newUserApiToken = response.body.data.token;
    });

    it('should retrieve your own profile: /api/v1/auth/me (GET)', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .auth(newUserApiToken, {
          type: 'bearer',
        })
        .send();

      // Debug: log response if data is missing
      if (!response.body.data) {
        console.error('Response body:', JSON.stringify(response.body, null, 2));
        console.error('Status:', response.status);
      }

      expect(response.body.data).toBeDefined();
      expect(response.body.data.provider).toBeDefined();
      expect(response.body.data.email).toBeDefined();
      expect(response.body.data.hash).not.toBeDefined();
      expect(response.body.data.password).not.toBeDefined();
    });

    it('should get new refresh token: /api/v1/auth/refresh (POST)', async () => {
      let newUserRefreshToken = await request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword })
        .then(({ body }) => body.data.refreshToken);

      newUserRefreshToken = await request(app)
        .post('/api/v1/auth/refresh')
        .auth(newUserRefreshToken, {
          type: 'bearer',
        })
        .send()
        .then(({ body }) => body.data.refreshToken);

      await request(app)
        .post('/api/v1/auth/refresh')
        .auth(newUserRefreshToken, {
          type: 'bearer',
        })
        .send()
        .expect(({ body }) => {
          expect(body.data.token).toBeDefined();
          expect(body.data.refreshToken).toBeDefined();
          expect(body.data.tokenExpires).toBeDefined();
        });
    });

    it('should fail on the second attempt to refresh token with the same token: /api/v1/auth/refresh (POST)', async () => {
      const newUserRefreshToken = await request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword })
        .then(({ body }) => body.data.refreshToken);

      await request(app)
        .post('/api/v1/auth/refresh')
        .auth(newUserRefreshToken, {
          type: 'bearer',
        })
        .send();

      await request(app)
        .post('/api/v1/auth/refresh')
        .auth(newUserRefreshToken, {
          type: 'bearer',
        })
        .send()
        .expect(401);
    });

    it('should echo a well-formed X-Request-Id and generate one when absent', async () => {
      await request(app).get('/api/health').set('X-Request-Id', 'e2e-req-1').expect('X-Request-Id', 'e2e-req-1');

      const { headers } = await request(app).get('/api/health').expect(200);
      expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should list, revoke and revoke other sessions: /api/v1/auth/sessions', async () => {
      const login = (userAgent: string): Promise<string> =>
        request(app)
          .post('/api/v1/auth/email/login')
          .set('User-Agent', userAgent)
          .send({ email: newUserEmail, password: newUserPassword })
          .then(({ body }) => body.data.token);
      const tokenA = await login('E2E-Device-A');
      const tokenB = await login('E2E-Device-B');
      const tokenC = await login('E2E-Device-C');

      await request(app).get('/api/v1/auth/me').auth(tokenB, { type: 'bearer' }).expect(200);
      await request(app).get('/api/v1/auth/me').auth(tokenC, { type: 'bearer' }).expect(200);

      const listed = await request(app).get('/api/v1/auth/sessions').auth(tokenA, { type: 'bearer' }).expect(200);
      const sessions = listed.body.data as { id: number; userAgent: string | null; current: boolean }[];
      const current = sessions.filter((session) => session.current);
      expect(current).toHaveLength(1);
      expect(current[0].userAgent).toBe('E2E-Device-A');
      const sessionB = sessions.find((session) => session.userAgent === 'E2E-Device-B');
      expect(sessionB).toBeDefined();

      await request(app).delete(`/api/v1/auth/sessions/${sessionB!.id}`).auth(tokenA, { type: 'bearer' }).expect(200);
      await request(app).get('/api/v1/auth/me').auth(tokenB, { type: 'bearer' }).expect(401);
      await request(app).delete(`/api/v1/auth/sessions/${sessionB!.id}`).auth(tokenA, { type: 'bearer' }).expect(404);

      await request(app).post('/api/v1/auth/sessions/revoke-others').auth(tokenA, { type: 'bearer' }).expect(200);
      await request(app).get('/api/v1/auth/me').auth(tokenC, { type: 'bearer' }).expect(401);

      const remaining = await request(app).get('/api/v1/auth/sessions').auth(tokenA, { type: 'bearer' }).expect(200);
      expect(remaining.body.data).toHaveLength(1);
      expect(remaining.body.data[0].current).toBe(true);
    });

    it('should update profile successfully: /api/v1/auth/me (PUT)', async () => {
      const newUserNewName = Date.now();
      const newUserNewPassword = md5('NewSecret00');
      const userToken = await request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword })
        .then(({ body }) => body.data.token);

      await request(app)
        .put('/api/v1/auth/me')
        .auth(userToken, {
          type: 'bearer',
        })
        .send({
          firstName: newUserNewName,
          password: newUserNewPassword,
        })
        .expect(422);

      await request(app)
        .put('/api/v1/auth/me')
        .auth(userToken, {
          type: 'bearer',
        })
        .send({
          firstName: newUserNewName,
          password: newUserNewPassword,
          oldPassword: newUserPassword,
        })
        .expect(200);

      await request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserNewPassword })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.token).toBeDefined();
        });

      await request(app)
        .put('/api/v1/auth/me')
        .auth(userToken, {
          type: 'bearer',
        })
        .send({ password: newUserPassword, oldPassword: newUserNewPassword })
        .expect(200);
    });

    it('should delete profile successfully: /api/v1/auth/me (DELETE)', async () => {
      const newUserApiToken = await request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword })
        .then(({ body }) => body.data.token);

      await request(app)
        .delete('/api/v1/auth/me')
        .auth(newUserApiToken, {
          type: 'bearer',
        })
        .send()
        .expect(422);

      await request(app)
        .delete('/api/v1/auth/me')
        .auth(newUserApiToken, {
          type: 'bearer',
        })
        .send({ oldPassword: newUserPassword })
        .expect(200);

      return request(app)
        .post('/api/v1/auth/email/login')
        .send({ email: newUserEmail, password: newUserPassword })
        .expect(422);
    });
  });
});
