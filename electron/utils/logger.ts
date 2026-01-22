type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

export const logger = {
  debug: (prefix: string, message: string, ...args: unknown[]) => {
    if (shouldLog('debug')) console.log(`[${prefix}]`, message, ...args)
  },
  info: (prefix: string, message: string, ...args: unknown[]) => {
    if (shouldLog('info')) console.log(`[${prefix}]`, message, ...args)
  },
  warn: (prefix: string, message: string, ...args: unknown[]) => {
    if (shouldLog('warn')) console.warn(`[${prefix}]`, message, ...args)
  },
  error: (prefix: string, message: string, ...args: unknown[]) => {
    if (shouldLog('error')) console.error(`[${prefix}]`, message, ...args)
  },
}
