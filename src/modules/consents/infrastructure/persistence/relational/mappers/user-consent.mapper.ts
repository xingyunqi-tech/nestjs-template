import { UserConsent } from '../../../../domain/user-consent';
import { UserConsentEntity } from '../entities/user-consent.entity';

export class UserConsentMapper {
  static toDomain(raw: UserConsentEntity): UserConsent {
    const domain = new UserConsent();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.type = raw.type;
    domain.version = raw.version;
    domain.agreedAt = raw.agreedAt;
    domain.ip = raw.ip;
    return domain;
  }
}
