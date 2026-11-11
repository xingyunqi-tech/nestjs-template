import { User } from '../../users/domain/user';

export class Session {
  id: number;
  user: User;
  hash: string;
  userAgent?: string | null;
  ip?: string | null;
  lastActiveAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}
