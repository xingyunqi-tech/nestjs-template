/**
 * Application-wide constants
 */

/**
 * Cache TTL in milliseconds
 */
export const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Database configuration constants
 */
export const DATABASE_CONSTANTS = {
  DEFAULT_PORT: 5432,
  MAX_CONNECTIONS: 80,
  CONNECTION_TIMEOUT_MS: 10_000,
  SLOW_QUERY_THRESHOLD_MS: 1000, // 1 second
} as const;

/**
 * Time constants in milliseconds
 */
export const TIME_CONSTANTS = {
  ONE_SECOND: 1000,
  ONE_MINUTE: 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
} as const;
