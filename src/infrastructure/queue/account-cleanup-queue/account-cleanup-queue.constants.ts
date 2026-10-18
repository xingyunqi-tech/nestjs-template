export const ACCOUNT_CLEANUP_QUEUE = 'account-cleanup';

export const ACCOUNT_CLEANUP_JOB_NAME = 'clean-account';

export interface AccountCleanupJobData {
  userId: number;
}

export const accountCleanupJobId = (userId: number): string => `user-${userId}`;
