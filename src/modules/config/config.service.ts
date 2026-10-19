import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import { AppConfigRepository } from './infrastructure/persistence/config.repository';
import { Config } from './domain/config';
import { ConfigKey, findConfigDefinition } from './config-definitions';

export const CONFIG_CACHE_TTL_MS = 60_000;

const CONFIG_VERSION_TTL_MS = 24 * 60 * 60 * 1000;

const configVersionKey = (key: string): string => `config:version:${key}`;

export const configCacheKey = (key: string, version: string): string => `config:${key}:${version}`;

interface CachedConfig {
  config: Config | null;
}

/** 缓存键带写入版本号，写入后旧版本的缓存不再被读取 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(
    private readonly configRepository: AppConfigRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async findPublicByKey(key: string): Promise<Config> {
    const config = await this.findEffective(key);
    if (!config?.isPublic) {
      throw new NotFoundException({ error: 'configNotFound' });
    }
    return config;
  }

  async findByKey(key: string): Promise<Config> {
    const config = await this.findEffective(key);
    if (!config) {
      throw new NotFoundException({ error: 'configNotFound' });
    }
    return config;
  }

  /** 读取登记项的配置值（`value.value`），未配置时返回登记的默认值 */
  async getValue<T = unknown>(key: ConfigKey): Promise<T | undefined> {
    const config = await this.load(key, true);
    if (config && Object.prototype.hasOwnProperty.call(config.value, 'value')) {
      return config.value.value as T;
    }
    return findConfigDefinition(key)?.defaultValue as T | undefined;
  }

  /** 通用写接口入口，拒绝由专用接口管理的登记项 */
  async upsertGeneric(key: string, value: Record<string, unknown>, isPublic?: boolean): Promise<Config> {
    if (findConfigDefinition(key)?.dedicated) {
      throw new UnprocessableEntityException({ errors: { key: 'configManagedByDedicatedEndpoint' } });
    }
    return this.upsert(key, value, isPublic);
  }

  /** 登记项的 isPublic 以登记表为准 */
  async upsert(key: string, value: Record<string, unknown>, isPublic?: boolean): Promise<Config> {
    this.logger.log(`Upsert config: ${key}`);
    const definition = findConfigDefinition(key);
    const config = await this.configRepository.upsert(key, value, definition?.isPublic ?? isPublic);
    await this.cacheManager.set(configVersionKey(key), randomUUID(), CONFIG_VERSION_TTL_MS);
    return definition ? { ...config, isPublic: definition.isPublic } : config;
  }

  private async findEffective(key: string): Promise<Config | null> {
    const definition = findConfigDefinition(key);
    const stored = await this.load(key, definition !== undefined);
    if (stored) {
      return definition ? { ...stored, isPublic: definition.isPublic } : stored;
    }
    if (definition?.defaultValue === undefined) {
      return null;
    }
    return {
      key,
      value: { value: definition.defaultValue },
      isPublic: definition.isPublic,
      createdAt: null,
      updatedAt: null,
    };
  }

  private async load(key: string, cacheMissing: boolean): Promise<Config | null> {
    const version = (await this.cacheManager.get<string>(configVersionKey(key))) ?? '0';
    const cacheKey = configCacheKey(key, version);
    const cached = await this.cacheManager.get<CachedConfig>(cacheKey);
    if (cached) {
      return cached.config && this.revive(cached.config);
    }

    const config = await this.configRepository.findByKey(key);
    if (config || cacheMissing) {
      await this.cacheManager.set(cacheKey, { config } satisfies CachedConfig, CONFIG_CACHE_TTL_MS);
    }
    return config;
  }

  private revive(config: Config): Config {
    return {
      ...config,
      createdAt: config.createdAt && new Date(config.createdAt),
      updatedAt: config.updatedAt && new Date(config.updatedAt),
    };
  }
}
