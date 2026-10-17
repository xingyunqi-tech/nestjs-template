export const IMPORT_FAILED_ALERT = 'importFailed';

const MB = 1024 * 1024;

export const IMPORT_PACKAGE_LIMITS = {
  maxEntries: 2000,
  maxTotalBytes: 300 * MB,
  maxRowsPerSheet: 10000,
} as const;

export const IMPORT_PROGRESS_INTERVAL = 20;

export const IMPORT_INTERRUPTED_REASON = 'importInterrupted';

export const IMPORT_STALE_TIMEOUTS = {
  runningMs: 30 * 60 * 1000,
  pendingMs: 10 * 60 * 1000,
} as const;
