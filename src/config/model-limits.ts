/**
 * Model context window limits for various AI models
 * Used to calculate context usage percentage
 */

/**
 * Known model context limits
 * Keys can be exact model IDs or patterns to match against
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude models (Anthropic) - 200k context
  'claude-opus-4-5-20251101': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,

  // OpenAI models
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,

  // Google Gemini models
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-1.0-pro': 32000,
  'gemini-pro': 32000,
}

/**
 * Default context limit for unknown models
 */
export const DEFAULT_CONTEXT_LIMIT = 128000

/**
 * Model prefix patterns and their default context limits
 */
const MODEL_PATTERNS: Array<{ pattern: RegExp; limit: number }> = [
  { pattern: /^claude-/, limit: 200000 },
  { pattern: /^gpt-4o/, limit: 128000 },
  { pattern: /^gpt-4-turbo/, limit: 128000 },
  { pattern: /^gpt-4/, limit: 8192 },
  { pattern: /^gpt-3\.5/, limit: 16385 },
  { pattern: /^gemini-1\.5/, limit: 1000000 },
  { pattern: /^gemini/, limit: 32000 },
]

/**
 * Get the context limit for a given model
 *
 * @param model - The model ID string
 * @returns The context window size in tokens
 *
 * Lookup order:
 * 1. Exact match in MODEL_CONTEXT_LIMITS
 * 2. Pattern match against MODEL_PATTERNS
 * 3. DEFAULT_CONTEXT_LIMIT fallback
 */
export function getContextLimit(model: string): number {
  // Check for exact match first
  if (model in MODEL_CONTEXT_LIMITS) {
    return MODEL_CONTEXT_LIMITS[model]!
  }

  // Check patterns
  for (const { pattern, limit } of MODEL_PATTERNS) {
    if (pattern.test(model)) {
      return limit
    }
  }

  // Fallback to default
  return DEFAULT_CONTEXT_LIMIT
}
