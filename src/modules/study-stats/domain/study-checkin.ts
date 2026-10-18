export enum CheckinReason {
  DAILY_DONE = 'DAILY_DONE',
  GOAL_REACHED = 'GOAL_REACHED',
}

export class StudyCheckin {
  id: string;
  userId: number;
  date: string;
  reason: CheckinReason;
  createdAt: Date;
  updatedAt: Date;
}
