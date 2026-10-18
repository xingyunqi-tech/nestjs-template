export const STUDY_STATS_QUEUE = 'study-stats';

export enum StudyStatsJobName {
  RECORD = 'apply-record',
  SESSION = 'apply-session',
}

export type StudyStatsJobData = { recordId: string } | { sessionId: string };

export const sessionJobId = (sessionId: string): string => `session-${sessionId}`;
