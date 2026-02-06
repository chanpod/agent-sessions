import log from 'electron-log/main'

// ============================================================================
// electron-log v5 configuration
// ============================================================================

// File transport settings
log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB per log file
log.transports.file.rotationMaxFiles = 3

// Log format with timestamps
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

// Initialize electron-log (required for v5)
log.initialize()

// ============================================================================
// Wrapped logger with same API shape: logger.info(prefix, message, ...args)
// ============================================================================

export const logger = {
  debug: (prefix: string, message: string, ...args: unknown[]) => {
    log.debug(`[${prefix}]`, message, ...args)
  },
  info: (prefix: string, message: string, ...args: unknown[]) => {
    log.info(`[${prefix}]`, message, ...args)
  },
  warn: (prefix: string, message: string, ...args: unknown[]) => {
    log.warn(`[${prefix}]`, message, ...args)
  },
  error: (prefix: string, message: string, ...args: unknown[]) => {
    log.error(`[${prefix}]`, message, ...args)
  },
}

// Export raw electron-log instance for direct access
export const electronLog = log

// Get the path to the current log file
export function getLogPath(): string {
  return log.transports.file.getFile().path
}
