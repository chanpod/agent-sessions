/**
 * Application constants - extracted from main.ts for maintainability
 */
export const CONSTANTS = {
  // Timeouts
  UPDATE_DISMISS_TIMEOUT_MS: 24 * 60 * 60 * 1000,  // 24 hours
  UPDATE_CHECK_INTERVAL_MS: 5 * 60 * 1000,          // 5 minutes
  DB_WAIT_TIMEOUT_MS: 5000,
  REVIEW_TIMEOUT_MS: 60000,
  COORDINATOR_TIMEOUT_MS: 90000,
  ACCURACY_TIMEOUT_MS: 120000,

  // Window dimensions
  WINDOW_DEFAULT_WIDTH: 1960,
  WINDOW_DEFAULT_HEIGHT: 1260,
  WINDOW_MIN_WIDTH: 800,
  WINDOW_MIN_HEIGHT: 600,

  // Limits
  MAX_DIRECTORY_DEPTH: 10,
  REVIEW_BATCH_SIZE: 5,
}

// Permission system
export const PERMISSION_REQUEST_TIMEOUT_MS = 30_000 // 30 seconds
export const PERMISSION_HOOK_FILENAME = 'permission-handler.js'
