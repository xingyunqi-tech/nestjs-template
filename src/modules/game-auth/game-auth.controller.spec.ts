import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import validationOptions from '../../common/validation-options';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { GameAuthController } from './game-auth.controller';
import { GameAuthService } from './game-auth.service';

describe('GameAuthController', () => {
  let app: INestApplication<App>;
  const service = {
    login: vi.fn(),
    refresh: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GameAuthController],
      providers: [{ provide: GameAuthService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the login result without the unified response wrapper', async () => {
    const result = { token: 't', refreshToken: 'r', expiresIn: 7200, userId: '7', serverTime: 1 };
    service.login.mockResolvedValue(result);

    const response = await request(app.getHttpServer())
      .post('/api/v1/game/auth/login')
      .send({ platform: 'wechat', code: 'code', deviceId: 'dev1' })
      .expect(200);

    expect(response.body).toEqual(result);
    expect(service.login).toHaveBeenCalledWith({ platform: 'wechat', code: 'code' });
  });

  it('should reject an unsupported platform', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/game/auth/login')
      .send({ platform: 'web', anonymousCode: 'dev1' })
      .expect(422);

    expect(service.login).not.toHaveBeenCalled();
  });

  it('should return the refresh result without the unified response wrapper', async () => {
    const result = { token: 't2', refreshToken: 'r2', expiresIn: 7200 };
    service.refresh.mockResolvedValue(result);

    const response = await request(app.getHttpServer())
      .post('/api/v1/game/auth/refresh')
      .send({ refreshToken: 'r' })
      .expect(200);

    expect(response.body).toEqual(result);
  });
});
