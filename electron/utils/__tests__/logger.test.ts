import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../logger'

describe('Logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('should format messages with prefix', () => {
    logger.info('Test', 'Hello world')
    expect(consoleSpy).toHaveBeenCalledWith('[Test]', 'Hello world')
  })

  it('should pass additional arguments', () => {
    logger.info('Test', 'Message', { data: 123 })
    expect(consoleSpy).toHaveBeenCalledWith('[Test]', 'Message', { data: 123 })
  })
})
