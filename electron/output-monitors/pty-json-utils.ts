/**
 * Shared PTY JSON parsing utilities
 * These handle the generic problem of extracting JSON objects from PTY output
 * streams that may contain ANSI codes and line-break corruption.
 */

/**
 * Strip ANSI escape codes from PTY output for clean parsing
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * Extracts complete JSON objects from a buffer using brace-matching.
 * Handles PTY output corruption where newlines are inserted mid-JSON.
 *
 * @param buffer - Raw input buffer that may contain partial/complete JSON objects
 * @returns Object with extracted JSON strings and remaining buffer content
 */
export function extractCompleteJsonObjects(buffer: string): {
  jsonObjects: string[]
  remaining: string
} {
  const jsonObjects: string[] = []
  let remaining = ''
  let i = 0

  while (i < buffer.length) {
    // Skip non-JSON content until we find a '{'
    if (buffer[i] !== '{') {
      i++
      continue
    }

    // Found a '{', try to extract a complete JSON object
    const startIndex = i
    let depth = 0
    let inString = false
    let escapeNext = false
    let j = i

    while (j < buffer.length) {
      const char = buffer[j]

      if (escapeNext) {
        escapeNext = false
        j++
        continue
      }

      if (char === '\\' && inString) {
        escapeNext = true
        j++
        continue
      }

      if (char === '"' && !escapeNext) {
        inString = !inString
        j++
        continue
      }

      if (!inString) {
        if (char === '{') {
          depth++
        } else if (char === '}') {
          depth--
          if (depth === 0) {
            // Found complete JSON object
            const jsonStr = buffer.slice(startIndex, j + 1)
            // Remove any embedded newlines/carriage returns that PTY may have inserted
            const cleanedJson = jsonStr.replace(/[\r\n]+/g, '')
            jsonObjects.push(cleanedJson)
            i = j + 1
            break
          }
        }
      }
      j++
    }

    // If we exited the loop without finding complete JSON, it's incomplete
    if (depth !== 0) {
      // Save from startIndex to end as remaining (incomplete JSON)
      remaining = buffer.slice(startIndex)
      break
    }
  }

  return { jsonObjects, remaining }
}
