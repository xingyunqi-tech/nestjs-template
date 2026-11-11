import type { Mocked } from 'vitest';
import { Cache } from 'cache-manager';
import { SessionService, sessionAuthCacheKey } from './session.service';
import { SessionRepository } from './infrastructure/persistence/session.repository';

describe('SessionService', () => {
  let repository: Mocked<
    Pick<
      SessionRepository,
      'rotateHash' | 'deleteById' | 'deleteByUserId' | 'deleteByUserIdWithExclude' | 'touch' | 'deleteByIdForUser'
    >
  >;
  let cache: Map<string, unknown>;
  let service: SessionService;

  beforeEach(() => {
    repository = {
      rotateHash: vi.fn(),
      deleteById: vi.fn(),
      deleteByUserId: vi.fn(),
      deleteByUserIdWithExclude: vi.fn(),
      touch: vi.fn(),
      deleteByIdForUser: vi.fn(),
    };
    cache = new Map();
    const cacheManager = {
      get: async (key: string) => cache.get(key),
      set: async (key: string, value: unknown) => cache.set(key, value),
      del: async (key: string) => cache.delete(key),
    } as unknown as Cache;
    service = new SessionService(repository as unknown as SessionRepository, cacheManager);
  });

  it('should remember the previous hash after a successful rotation', async () => {
    repository.rotateHash.mockResolvedValue(true);

    await expect(service.rotateHash(10, 'H1', 'H2')).resolves.toBe(true);

    await expect(service.wasRecentlyRotatedFrom(10, 'H1')).resolves.toBe(true);
    await expect(service.wasRecentlyRotatedFrom(10, 'H0')).resolves.toBe(false);
  });

  it('should not remember the hash when the rotation lost the race', async () => {
    repository.rotateHash.mockResolvedValue(false);

    await service.rotateHash(10, 'H1', 'H2');

    await expect(service.wasRecentlyRotatedFrom(10, 'H1')).resolves.toBe(false);
  });

  it('should clear the token validation cache of sessions deleted elsewhere', async () => {
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });
    cache.set(sessionAuthCacheKey(11), { statusId: 1 });

    await service.forgetSessions([10, 11]);

    expect(cache.size).toBe(0);
  });

  it('should clear the token validation cache when revoking', async () => {
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });

    await service.revoke(10);

    expect(repository.deleteById).toHaveBeenCalledWith(10);
    expect(cache.has(sessionAuthCacheKey(10))).toBe(false);
  });

  it('should clear the token validation cache when deleting a session', async () => {
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });

    await service.deleteById(10);

    expect(repository.deleteById).toHaveBeenCalledWith(10);
    expect(cache.has(sessionAuthCacheKey(10))).toBe(false);
  });

  it('should clear the token validation cache of the other deleted sessions', async () => {
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });
    cache.set(sessionAuthCacheKey(11), { statusId: 1 });
    cache.set(sessionAuthCacheKey(12), { statusId: 1 });
    repository.deleteByUserIdWithExclude.mockResolvedValue([11, 12]);

    await service.deleteByUserIdWithExclude({ userId: 1, excludeSessionId: 10 });

    expect(cache.has(sessionAuthCacheKey(10))).toBe(true);
    expect(cache.has(sessionAuthCacheKey(11))).toBe(false);
    expect(cache.has(sessionAuthCacheKey(12))).toBe(false);
  });

  it('should clear the token validation cache of every deleted session of the user', async () => {
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });
    cache.set(sessionAuthCacheKey(11), { statusId: 1 });
    repository.deleteByUserId.mockResolvedValue([10, 11]);

    await service.deleteByUserId({ userId: 1 });

    expect(repository.deleteByUserId).toHaveBeenCalledWith({ userId: 1 });
    expect(cache.size).toBe(0);
  });

  it('should record activity only when the last record is older than five minutes', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-10T12:00:00Z') });
    try {
      await service.touch(10);
    } finally {
      vi.useRealTimers();
    }

    expect(repository.touch).toHaveBeenCalledWith(
      10,
      new Date('2026-11-10T12:00:00Z'),
      new Date('2026-11-10T11:55:00Z'),
    );
  });

  it('should not fail the request when recording activity fails', async () => {
    repository.touch.mockRejectedValue(new Error('db down'));

    await expect(service.touch(10)).resolves.toBeUndefined();
  });

  it('should clear the token validation cache when the user revokes an own session', async () => {
    repository.deleteByIdForUser.mockResolvedValue(true);
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });

    await expect(service.revokeForUser(10, 1)).resolves.toBe(true);

    expect(repository.deleteByIdForUser).toHaveBeenCalledWith(10, 1);
    expect(cache.has(sessionAuthCacheKey(10))).toBe(false);
  });

  it('should keep the cache when the session does not belong to the user', async () => {
    repository.deleteByIdForUser.mockResolvedValue(false);
    cache.set(sessionAuthCacheKey(10), { statusId: 1 });

    await expect(service.revokeForUser(10, 2)).resolves.toBe(false);

    expect(cache.has(sessionAuthCacheKey(10))).toBe(true);
  });
});
