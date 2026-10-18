export const STUDY_STATS_QUEUE = 'study-stats';

export enum StudyStatsJobName {
  RECORD = 'apply-record',
  SESSION = 'apply-session',
  CHECK_IN = 'evaluate-check-in',
}

export type StudyStatsJobData = { recordId: string } | { sessionId: string } | { userId: number; date: string };

export const sessionJobId = (sessionId: string): string => `session-${sessionId}`;

export const checkInJobId = (userId: number, date: string): string => `checkin-${userId}-${date}`;
