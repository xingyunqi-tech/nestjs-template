import { ConsentType } from './consent-type';

export class UserConsent {
  id: string;
  userId: number;
  type: ConsentType;
  version: string;
  agreedAt: Date;
  ip: string | null;
}
