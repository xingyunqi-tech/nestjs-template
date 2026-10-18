import { HttpStatus, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { UserConsentRepository } from './infrastructure/persistence/user-consent.repository';
import { ConsentType } from './domain/consent-type';
import { UserConsent } from './domain/user-consent';
import { ConsentStatusDto } from './dto/consent-status.dto';
import { AgreeConsentDto } from './dto/agree-consent.dto';
import { AppConfigService } from '../config/config.service';
import { ConfigKey } from '../config/config-definitions';

const VERSION_KEYS: Record<ConsentType, ConfigKey> = {
  [ConsentType.PRIVACY_POLICY]: 'consent.privacyPolicyVersion',
  [ConsentType.USER_AGREEMENT]: 'consent.userAgreementVersion',
  [ConsentType.AI_SERVICE]: 'consent.aiServiceVersion',
};

const CONSENT_TYPES = Object.values(ConsentType);

@Injectable()
export class ConsentsService {
  constructor(
    private readonly userConsentRepository: UserConsentRepository,
    private readonly appConfigService: AppConfigService,
  ) {}

  async findStatus(userId: number): Promise<ConsentStatusDto[]> {
    const [versions, latest] = await Promise.all([
      Promise.all(CONSENT_TYPES.map((type) => this.currentVersion(type))),
      this.userConsentRepository.findLatestByUser(userId),
    ]);
    const latestByType = new Map(latest.map((consent) => [consent.type, consent]));
    const agreedCurrent = await Promise.all(
      CONSENT_TYPES.map((type, index) => this.agreedCurrent(userId, type, versions[index], latestByType.get(type))),
    );
    return CONSENT_TYPES.map((type, index) =>
      this.toStatus(type, versions[index], latestByType.get(type), agreedCurrent[index]),
    );
  }

  async agree(userId: number, dto: AgreeConsentDto, ip: string | null): Promise<ConsentStatusDto> {
    const currentVersion = await this.currentVersion(dto.type);
    if (currentVersion === null || dto.version !== currentVersion) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { version: 'consentVersionNotCurrent' },
      });
    }
    await this.userConsentRepository.insertIfAbsent({ userId, type: dto.type, version: dto.version, ip });
    const agreed = await this.userConsentRepository.findOne(userId, dto.type, dto.version);
    return this.toStatus(dto.type, currentVersion, agreed ?? undefined, true);
  }

  /** 已同意该协议的当前版本；未配置当前版本时为 false */
  async hasAgreedCurrent(userId: number, type: ConsentType): Promise<boolean> {
    const currentVersion = await this.currentVersion(type);
    return currentVersion !== null && this.userConsentRepository.exists(userId, type, currentVersion);
  }

  hasAgreedAiService(userId: number): Promise<boolean> {
    return this.hasAgreedCurrent(userId, ConsentType.AI_SERVICE);
  }

  private async currentVersion(type: ConsentType): Promise<string | null> {
    const value = await this.appConfigService.getValue<unknown>(VERSION_KEYS[type]);
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  }

  private async agreedCurrent(
    userId: number,
    type: ConsentType,
    currentVersion: string | null,
    latest: UserConsent | undefined,
  ): Promise<boolean> {
    if (currentVersion === null || !latest) {
      return false;
    }
    return latest.version === currentVersion || this.userConsentRepository.exists(userId, type, currentVersion);
  }

  private toStatus(
    type: ConsentType,
    currentVersion: string | null,
    latest: UserConsent | undefined,
    agreed: boolean,
  ): ConsentStatusDto {
    return {
      type,
      currentVersion,
      agreedVersion: latest?.version ?? null,
      agreedAt: latest?.agreedAt ?? null,
      agreed,
      needsConsent: currentVersion !== null && !agreed,
    };
  }
}
