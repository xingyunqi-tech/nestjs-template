import type { Mocked } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AppConfigService } from './config.service';
import { AppConfigRepository } from './infrastructure/persistence/config.repository';
import { Config } from './domain/config';
import { findConfigDefinition } from './config-definitions';
import type { Cache } from 'cache-manager';

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    key: 'app.theme',
    value: { primaryColor: '#1890ff' },
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AppConfigService', () => {
  let repository: Mocked<AppConfigRepository>;
  let service: AppConfigService;

  let cache: Map<string, unknown>;

  beforeEach(() => {
    repository = { findByKey: vi.fn(), upsert: vi.fn() };
    cache = new Map();
    const cacheManager = {
      get: async (key: string) => (cache.has(key) ? JSON.parse(cache.get(key) as string) : undefined),
      set: async (key: string, value: unknown) => cache.set(key, JSON.stringify(value)),
      del: async (key: string) => cache.delete(key),
    } as unknown as Cache;
    service = new AppConfigService(repository, cacheManager);
  });

  describe('findPublicByKey', () => {
    it('should return a public config', async () => {
      repository.findByKey.mockResolvedValue(buildConfig());
      await expect(service.findPublicByKey('app.theme')).resolves.toMatchObject({ key: 'app.theme' });
    });

    it('should throw 404 for a private config', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ isPublic: false }));
      await expect(service.findPublicByKey('app.theme')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should throw 404 when the config does not exist', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.findPublicByKey('app.theme')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByKey', () => {
    it('should return a private config', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ isPublic: false }));
      await expect(service.findByKey('app.theme')).resolves.toMatchObject({ isPublic: false });
    });
  });

  describe('registered keys', () => {
    it('should return the registered default of a public key absent from the database', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.findPublicByKey('ai.enabled')).resolves.toEqual({
        key: 'ai.enabled',
        value: { value: true },
        isPublic: true,
        createdAt: null,
        updatedAt: null,
      });
    });

    it('should hide a private registered key from the public endpoint', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.findPublicByKey('ai.ratePerMinute')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should return 404 for a registered key without default absent from the database', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.findByKey('ai.model')).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['agreement.userAgreement', 'agreement.privacyPolicy', 'agreement.aiService'])(
      'should register %s as a public string without default',
      async (key) => {
        expect(findConfigDefinition(key)).toMatchObject({ type: 'string', isPublic: true });
        expect(findConfigDefinition(key)).not.toHaveProperty('defaultValue');

        repository.findByKey.mockResolvedValue(null);
        await expect(service.findPublicByKey(key)).rejects.toBeInstanceOf(NotFoundException);
      },
    );

    it('should serve a stored agreement HTML through the public endpoint', async () => {
      const html = `<h1>用户协议</h1>${'<p>条款内容</p>'.repeat(10_000)}`;
      repository.findByKey.mockResolvedValue(
        buildConfig({ key: 'agreement.userAgreement', value: { value: html }, isPublic: false }),
      );
      await expect(service.findPublicByKey('agreement.userAgreement')).resolves.toMatchObject({
        isPublic: true,
        value: { value: html },
      });
    });

    it('should take isPublic from the registry over the stored flag', async () => {
      repository.findByKey.mockResolvedValue(
        buildConfig({ key: 'ai.enabled', value: { value: false }, isPublic: false }),
      );
      await expect(service.findPublicByKey('ai.enabled')).resolves.toMatchObject({ value: { value: false } });

      repository.findByKey.mockResolvedValue(buildConfig({ key: 'ai.ratePerMinute', isPublic: true }));
      await expect(service.findPublicByKey('ai.ratePerMinute')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should store the registry isPublic on write', async () => {
      repository.upsert.mockResolvedValue(buildConfig({ key: 'ai.ratePerMinute', isPublic: false }));
      await service.upsert('ai.ratePerMinute', { value: 20 }, true);
      expect(repository.upsert).toHaveBeenCalledWith('ai.ratePerMinute', { value: 20 }, false);

      repository.upsert.mockResolvedValue(buildConfig());
      await service.upsert('app.theme', { primaryColor: '#000' }, true);
      expect(repository.upsert).toHaveBeenLastCalledWith('app.theme', { primaryColor: '#000' }, true);
    });
  });

  describe('cache', () => {
    it('should serve repeated reads from the cache', async () => {
      repository.findByKey.mockResolvedValue(buildConfig());
      await service.findByKey('app.theme');
      const config = await service.findByKey('app.theme');

      expect(repository.findByKey).toHaveBeenCalledTimes(1);
      expect(config.createdAt).toBeInstanceOf(Date);
    });

    it('should cache a missing registered key', async () => {
      repository.findByKey.mockResolvedValue(null);
      await service.findPublicByKey('ai.enabled');
      await service.findPublicByKey('ai.enabled');

      expect(repository.findByKey).toHaveBeenCalledTimes(1);
    });

    it('should not cache a missing unregistered key', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.findByKey('unknown.key')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findByKey('unknown.key')).rejects.toBeInstanceOf(NotFoundException);

      expect(repository.findByKey).toHaveBeenCalledTimes(2);
      expect(cache.size).toBe(0);
    });

    it('should return the new value after an update', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ key: 'ai.enabled', value: { value: true } }));
      await expect(service.getValue('ai.enabled')).resolves.toBe(true);

      const updated = buildConfig({ key: 'ai.enabled', value: { value: false } });
      repository.upsert.mockResolvedValue(updated);
      repository.findByKey.mockResolvedValue(updated);
      await service.upsert('ai.enabled', { value: false });

      await expect(service.getValue('ai.enabled')).resolves.toBe(false);
    });

    it('should not serve a stale value cached by a read that raced with an update', async () => {
      const stale = buildConfig({ key: 'ai.enabled', value: { value: true } });
      const updated = buildConfig({ key: 'ai.enabled', value: { value: false } });
      let releaseRead!: () => void;
      repository.findByKey.mockImplementationOnce(() => new Promise((resolve) => (releaseRead = () => resolve(stale))));

      const racingRead = service.getValue('ai.enabled');
      await new Promise((resolve) => setImmediate(resolve));
      repository.upsert.mockResolvedValue(updated);
      await service.upsert('ai.enabled', { value: false });
      releaseRead();
      await racingRead;

      repository.findByKey.mockResolvedValue(updated);
      await expect(service.getValue('ai.enabled')).resolves.toBe(false);
    });
  });

  describe('getValue', () => {
    it('should return the registered default when the config is absent', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.getValue('wrongBook.masterThreshold')).resolves.toBe(3);
    });

    it('should return undefined for a registered key without default', async () => {
      repository.findByKey.mockResolvedValue(null);
      await expect(service.getValue('ai.dailyBudget')).resolves.toBeUndefined();
    });

    it('should return the stored value over the default', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ key: 'ai.quota.chat', value: { value: 50 } }));
      await expect(service.getValue('ai.quota.chat')).resolves.toBe(50);
    });

    it('should fall back to the default when the stored value has no value field', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ key: 'ai.quota.chat', value: {} }));
      await expect(service.getValue('ai.quota.chat')).resolves.toBe(20);
    });
  });

  describe('app.profile', () => {
    const profile = { value: { appName: '备考刷题' } };

    it('should hide app.profile from the public endpoint', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ key: 'app.profile', value: profile, isPublic: true }));
      await expect(service.findPublicByKey('app.profile')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should read app.profile through getValue', async () => {
      repository.findByKey.mockResolvedValue(buildConfig({ key: 'app.profile', value: profile, isPublic: false }));
      await expect(service.getValue('app.profile')).resolves.toEqual({ appName: '备考刷题' });
    });

    it('should reject writing app.profile through the generic endpoint', async () => {
      await expect(service.upsertGeneric('app.profile', profile)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('should write app.profile through upsert', async () => {
      repository.upsert.mockResolvedValue(buildConfig({ key: 'app.profile', value: profile, isPublic: false }));
      await service.upsert('app.profile', profile);
      expect(repository.upsert).toHaveBeenCalledWith('app.profile', profile, false);
    });

    it('should write other keys through the generic endpoint', async () => {
      repository.upsert.mockResolvedValue(buildConfig());
      await service.upsertGeneric('app.theme', { primaryColor: '#000' }, true);
      expect(repository.upsert).toHaveBeenCalledWith('app.theme', { primaryColor: '#000' }, true);
    });
  });
});
