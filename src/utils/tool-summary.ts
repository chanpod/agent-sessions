/**
 * Generates brief one-line summaries from tool input JSON for compact display.
 */

function truncate(str: string, maxLen: number): string {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '\u2026'
}

function shortenPath(filePath: string, maxLen: number): string {
  if (!filePath || filePath.length <= maxLen) return filePath
  // Try to keep filename + some parent context
  const parts = filePath.split('/')
  if (parts.length <= 2) return truncate(filePath, maxLen)
  const file = parts[parts.length - 1]
  const parent = parts[parts.length - 2]
  const short = `\u2026/${parent}/${file}`
  return short.length <= maxLen ? short : truncate(filePath, maxLen)
}

export function generateToolSummary(toolName: string, input: string): string {
  try {
    const parsed = JSON.parse(input)

    switch (toolName) {
      case 'Read':
        return shortenPath(parsed.file_path || parsed.path || '', 50)

      case 'Edit':
        return shortenPath(parsed.file_path || parsed.path || '', 50)

      case 'Write':
        return shortenPath(parsed.file_path || parsed.path || '', 50)

      case 'Grep':
      case 'grep': {
        const pattern = parsed.pattern || ''
        const scope = parsed.glob || parsed.type || parsed.path || ''
        return scope
          ? `'${truncate(pattern, 20)}' in ${truncate(scope, 25)}`
          : `'${truncate(pattern, 40)}'`
      }

      case 'Glob':
        return truncate(parsed.pattern || '', 50)

      case 'Bash': {
        const cmd = parsed.command || ''
        return truncate(cmd, 55)
      }

      case 'WebFetch': {
        try {
          const url = new URL(parsed.url || '')
          return truncate(url.hostname + url.pathname, 50)
        } catch {
          return truncate(parsed.url || '', 50)
        }
      }

      case 'WebSearch':
        return truncate(parsed.query || '', 50)

      case 'Task':
        return truncate(parsed.description || parsed.prompt?.slice(0, 50) || '', 50)

      case 'TodoWrite':
        return `${parsed.todos?.length || 0} items`

      case 'AskUserQuestion':
        return truncate(parsed.questions?.[0]?.question || '', 50)

      case 'NotebookEdit':
        return shortenPath(parsed.notebook_path || '', 40)

      default: {
        // Generic: first string param value
        const firstVal = Object.values(parsed).find((v) => typeof v === 'string')
        if (typeof firstVal === 'string') {
          return truncate(firstVal, 50)
        }
        return Object.keys(parsed).slice(0, 3).join(', ')
      }
    }
  } catch {
    return ''
  }
}
