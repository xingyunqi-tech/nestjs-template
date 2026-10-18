import { NullableType } from '../../../../common/types/nullable.type';
import { ConsentType } from '../../domain/consent-type';
import { UserConsent } from '../../domain/user-consent';

export abstract class UserConsentRepository {
  /** 已同意过同一版本时保留原记录 */
  abstract insertIfAbsent(data: Pick<UserConsent, 'userId' | 'type' | 'version' | 'ip'>): Promise<void>;

  /** 每种协议最近一次同意的记录 */
  abstract findLatestByUser(userId: number): Promise<UserConsent[]>;

  abstract exists(userId: number, type: ConsentType, version: string): Promise<boolean>;

  abstract findOne(userId: number, type: ConsentType, version: string): Promise<NullableType<UserConsent>>;
}
