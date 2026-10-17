import redisConfig, { assertRedisEnabledInProduction } from './redis.config';

describe('redis config', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('should reject production without Redis', () => {
    expect(() => assertRedisEnabledInProduction({ NODE_ENV: 'production', REDIS_ENABLED: 'false' })).toThrow(
      'REDIS_ENABLED=true is required when NODE_ENV=production',
    );
    expect(() => assertRedisEnabledInProduction({ NODE_ENV: 'production' })).toThrow();
  });

  it('should accept production with Redis enabled', () => {
    expect(() => assertRedisEnabledInProduction({ NODE_ENV: 'production', REDIS_ENABLED: 'true' })).not.toThrow();
  });

  it('should allow other environments without Redis', () => {
    expect(() => assertRedisEnabledInProduction({ NODE_ENV: 'development', REDIS_ENABLED: 'false' })).not.toThrow();
    expect(() => assertRedisEnabledInProduction({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('should fail to load the config in production without Redis', () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_ENABLED = 'false';
    expect(() => redisConfig()).toThrow('REDIS_ENABLED=true is required when NODE_ENV=production');
  });
});
