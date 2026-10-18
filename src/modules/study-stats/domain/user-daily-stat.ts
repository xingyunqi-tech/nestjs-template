export class UserDailyStat {
  id: string;
  userId: number;
  date: string;
  subjectId: string;
  answered: number;
  correct: number;
  durationSec: number;
  createdAt: Date;
  updatedAt: Date;
}
