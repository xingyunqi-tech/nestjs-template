import type { Mocked } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { ConsentsService } from './consents.service';
import { UserConsentRepository } from './infrastructure/persistence/user-consent.repository';
import { ConsentType } from './domain/consent-type';
import { UserConsent } from './domain/user-consent';
import { AppConfigService } from '../config/config.service';

describe('ConsentsService', () => {
  let repository: Mocked<UserConsentRepository>;
  let versions: Record<string, unknown>;
  let service: ConsentsService;

  const consent = (type: ConsentType, version: string, agreedAt = new Date('2026-10-01T00:00:00Z')): UserConsent =>
    Object.assign(new UserConsent(), { id: `${type}-${version}`, userId: 1, type, version, agreedAt, ip: null });

  beforeEach(() => {
    versions = {
      'consent.privacyPolicyVersion': 'p2',
      'consent.userAgreementVersion': 'u1',
      'consent.aiServiceVersion': undefined,
    };
    repository = {
      insertIfAbsent: vi.fn().mockResolvedValue(undefined),
      findLatestByUser: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false),
      findOne: vi.fn().mockResolvedValue(null),
    };
    const config = { getValue: vi.fn((key: string) => Promise.resolve(versions[key])) };
    service = new ConsentsService(repository, config as unknown as AppConfigService);
  });

  describe('findStatus', () => {
    it('should report each agreement with its current version and whether it needs consent', async () => {
      const agreedAt = new Date('2026-09-01T00:00:00Z');
      repository.findLatestByUser.mockResolvedValue([
        consent(ConsentType.PRIVACY_POLICY, 'p1', agreedAt),
        consent(ConsentType.USER_AGREEMENT, 'u1', agreedAt),
      ]);

      await expect(service.findStatus(1)).resolves.toEqual([
        {
          type: ConsentType.PRIVACY_POLICY,
          currentVersion: 'p2',
          agreedVersion: 'p1',
          agreedAt,
          agreed: false,
          needsConsent: true,
        },
        {
          type: ConsentType.USER_AGREEMENT,
          currentVersion: 'u1',
          agreedVersion: 'u1',
          agreedAt,
          agreed: true,
          needsConsent: false,
        },
        {
          type: ConsentType.AI_SERVICE,
          currentVersion: null,
          agreedVersion: null,
          agreedAt: null,
          agreed: false,
          needsConsent: false,
        },
      ]);
      expect(repository.exists).toHaveBeenCalledWith(1, ConsentType.PRIVACY_POLICY, 'p2');
    });

    it('should treat an earlier agreement of the current version as agreed', async () => {
      repository.findLatestByUser.mockResolvedValue([consent(ConsentType.PRIVACY_POLICY, 'p3')]);
      repository.exists.mockResolvedValue(true);

      const [privacy] = await service.findStatus(1);

      expect(privacy).toMatchObject({ agreedVersion: 'p3', agreed: true, needsConsent: false });
    });

    it('should require consent from a user who never agreed', async () => {
      const [privacy, agreement] = await service.findStatus(1);

      expect(privacy).toMatchObject({ agreedVersion: null, agreed: false, needsConsent: true });
      expect(agreement).toMatchObject({ agreedVersion: null, agreed: false, needsConsent: true });
      expect(repository.exists).not.toHaveBeenCalled();
    });
  });

  describe('agree', () => {
    it('should record the consent of the current version with the ip', async () => {
      repository.findOne.mockResolvedValue(consent(ConsentType.PRIVACY_POLICY, 'p2'));

      await expect(
        service.agree(1, { type: ConsentType.PRIVACY_POLICY, version: 'p2' }, '10.0.0.1'),
      ).resolves.toMatchObject({
        type: ConsentType.PRIVACY_POLICY,
        agreedVersion: 'p2',
        agreed: true,
        needsConsent: false,
      });
      expect(repository.insertIfAbsent).toHaveBeenCalledWith({
        userId: 1,
        type: ConsentType.PRIVACY_POLICY,
        version: 'p2',
        ip: '10.0.0.1',
      });
      expect(repository.findOne).toHaveBeenCalledWith(1, ConsentType.PRIVACY_POLICY, 'p2');
    });

    it('should reject a version other than the current one', async () => {
      const error = await service
        .agree(1, { type: ConsentType.PRIVACY_POLICY, version: 'p1' }, null)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        errors: { version: 'consentVersionNotCurrent' },
      });
      expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it('should reject an agreement without a configured version', async () => {
      await expect(service.agree(1, { type: ConsentType.AI_SERVICE, version: 'a1' }, null)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('hasAgreedAiService', () => {
    it('should check the current AI service version', async () => {
      versions['consent.aiServiceVersion'] = 'a2';
      repository.exists.mockResolvedValue(true);

      await expect(service.hasAgreedAiService(1)).resolves.toBe(true);
      expect(repository.exists).toHaveBeenCalledWith(1, ConsentType.AI_SERVICE, 'a2');
    });

    it('should be false without a configured version', async () => {
      await expect(service.hasAgreedAiService(1)).resolves.toBe(false);
      expect(repository.exists).not.toHaveBeenCalled();
    });
  });
});
