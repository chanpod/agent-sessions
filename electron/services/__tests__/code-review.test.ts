import { describe, it, expect } from 'vitest'
import {
  parseFindings,
  consolidateFindings,
  filterVerifiedFindings,
  generateFindingId
} from '../code-review.js'
import type { Finding, SubAgentReview } from '../../types/index.js'

describe('Code Review Service', () => {
  describe('parseFindings', () => {
    it('should parse valid JSON array of findings', () => {
      const output = JSON.stringify([
        {
          file: 'test.ts',
          line: 42,
          severity: 'error',
          category: 'Security',
          title: 'SQL injection',
          description: 'User input is not sanitized'
        }
      ])

      const result = parseFindings(output)

      expect(result).toHaveLength(1)
      expect(result[0].file).toBe('test.ts')
      expect(result[0].line).toBe(42)
      expect(result[0].severity).toBe('error')
      expect(result[0].category).toBe('Security')
    })

    it('should handle empty input', () => {
      expect(parseFindings('')).toEqual([])
      expect(parseFindings('   ')).toEqual([])
    })

    it('should handle null/undefined input', () => {
      expect(parseFindings(null as unknown as string)).toEqual([])
      expect(parseFindings(undefined as unknown as string)).toEqual([])
    })

    it('should parse JSON wrapped in markdown code block', () => {
      const output = '```json\n[{"file": "app.ts", "line": 10, "severity": "warning"}]\n```'

      const result = parseFindings(output)

      expect(result).toHaveLength(1)
      expect(result[0].file).toBe('app.ts')
      expect(result[0].line).toBe(10)
    })

    it('should parse JSON wrapped in plain code block', () => {
      const output = '```\n[{"file": "app.ts", "line": 10, "severity": "warning"}]\n```'

      const result = parseFindings(output)

      expect(result).toHaveLength(1)
      expect(result[0].file).toBe('app.ts')
    })

    it('should extract JSON array from surrounding text', () => {
      const output = 'Here are the findings:\n[{"file": "test.ts", "line": 5, "severity": "error"}]\nEnd of findings.'

      const result = parseFindings(output)

      expect(result).toHaveLength(1)
      expect(result[0].file).toBe('test.ts')
    })

    it('should handle invalid JSON gracefully', () => {
      expect(parseFindings('not valid json')).toEqual([])
      expect(parseFindings('[{"file": "test.ts"')).toEqual([])
      expect(parseFindings('{"file": "test.ts"}')).toEqual([]) // Missing line
    })

    it('should filter out findings without required fields', () => {
      const output = JSON.stringify([
        { file: 'valid.ts', line: 10, severity: 'error' },
        { line: 20, severity: 'warning' }, // Missing file
        { file: 'noLine.ts', severity: 'error' }, // Missing line
        { file: '', line: 5, severity: 'error' }, // Empty file
        { file: 'invalidLine.ts', line: -1, severity: 'error' } // Invalid line
      ])

      const result = parseFindings(output)

      expect(result).toHaveLength(1)
      expect(result[0].file).toBe('valid.ts')
    })

    it('should default severity to warning for invalid values', () => {
      const output = JSON.stringify([{ file: 'test.ts', line: 10, severity: 'invalid' }])

      const result = parseFindings(output)

      expect(result[0].severity).toBe('warning')
    })

    it('should parse all valid severity levels', () => {
      const output = JSON.stringify([
        { file: 'test.ts', line: 1, severity: 'critical' },
        { file: 'test.ts', line: 2, severity: 'error' },
        { file: 'test.ts', line: 3, severity: 'warning' },
        { file: 'test.ts', line: 4, severity: 'suggestion' }
      ])

      const result = parseFindings(output)

      expect(result.map((f) => f.severity)).toEqual(['critical', 'error', 'warning', 'suggestion'])
    })

    it('should parse optional fields', () => {
      const output = JSON.stringify([
        {
          file: 'test.ts',
          line: 42,
          endLine: 45,
          column: 10,
          severity: 'error',
          category: 'Security',
          title: 'SQL injection',
          message: 'Short message',
          description: 'Detailed description',
          code: 'const x = y',
          suggestion: 'Use parameterized queries',
          aiPrompt: 'Fix the SQL injection',
          confidence: 0.95,
          id: 'finding-1',
          sourceAgents: ['agent-1', 'agent-2']
        }
      ])

      const result = parseFindings(output)

      expect(result[0]).toMatchObject({
        file: 'test.ts',
        line: 42,
        endLine: 45,
        column: 10,
        severity: 'error',
        category: 'Security',
        title: 'SQL injection',
        message: 'Short message',
        description: 'Detailed description',
        code: 'const x = y',
        suggestion: 'Use parameterized queries',
        aiPrompt: 'Fix the SQL injection',
        confidence: 0.95,
        id: 'finding-1',
        sourceAgents: ['agent-1', 'agent-2']
      })
    })

    it('should parse codeChange object', () => {
      const output = JSON.stringify([
        {
          file: 'test.ts',
          line: 10,
          severity: 'error',
          codeChange: {
            oldCode: 'const x = y + z',
            newCode: 'const x = y.add(z)'
          }
        }
      ])

      const result = parseFindings(output)

      expect(result[0].codeChange).toEqual({
        oldCode: 'const x = y + z',
        newCode: 'const x = y.add(z)'
      })
    })

    it('should handle single finding object (not array)', () => {
      const output = JSON.stringify({ file: 'test.ts', line: 5, severity: 'warning' })

      const result = parseFindings(output)

      expect(result).toHaveLength(1)
      expect(result[0].file).toBe('test.ts')
    })

    it('should parse line number from string', () => {
      const output = JSON.stringify([{ file: 'test.ts', line: '42', severity: 'error' }])

      const result = parseFindings(output)

      expect(result[0].line).toBe(42)
    })
  })

  describe('consolidateFindings', () => {
    it('should return empty array for empty input', () => {
      expect(consolidateFindings([])).toEqual([])
      expect(consolidateFindings(null as unknown as SubAgentReview[])).toEqual([])
    })

    it('should consolidate findings from single agent', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result).toHaveLength(1)
      expect(result[0].sourceAgents).toContain('agent-1')
      expect(result[0].confidence).toBe(0.65) // Single agent confidence
    })

    it('should deduplicate identical findings from multiple agents', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', category: 'Security', title: 'SQL injection' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-2',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', category: 'Security', title: 'SQL injection' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-3',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', category: 'Security', title: 'SQL injection' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result).toHaveLength(1)
      expect(result[0].sourceAgents).toEqual(['agent-1', 'agent-2', 'agent-3'])
      expect(result[0].confidence).toBe(1.0) // Three agents
    })

    it('should preserve unique findings from each agent', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', title: 'Bug A' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-2',
          findings: [{ file: 'test.ts', line: 20, severity: 'warning', title: 'Bug B' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result).toHaveLength(2)
      expect(result.map((f) => f.title)).toContain('Bug A')
      expect(result.map((f) => f.title)).toContain('Bug B')
    })

    it('should merge descriptions keeping the longer one', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', title: 'Bug', description: 'Short' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-2',
          findings: [
            { file: 'test.ts', line: 10, severity: 'error', title: 'Bug', description: 'A much longer description with more details' }
          ],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result[0].description).toBe('A much longer description with more details')
    })

    it('should calculate confidence correctly based on agent count', () => {
      const createReview = (agentId: string): SubAgentReview => ({
        agentId,
        findings: [{ file: 'test.ts', line: 10, severity: 'error', title: 'Same Bug' }],
        timestamp: Date.now()
      })

      // Single agent
      let result = consolidateFindings([createReview('agent-1')])
      expect(result[0].confidence).toBe(0.65)

      // Two agents
      result = consolidateFindings([createReview('agent-1'), createReview('agent-2')])
      expect(result[0].confidence).toBe(0.85)

      // Three agents
      result = consolidateFindings([createReview('agent-1'), createReview('agent-2'), createReview('agent-3')])
      expect(result[0].confidence).toBe(1.0)
    })

    it('should handle reviews with empty findings', () => {
      const reviews: SubAgentReview[] = [
        { agentId: 'agent-1', findings: [], timestamp: Date.now() },
        {
          agentId: 'agent-2',
          findings: [{ file: 'test.ts', line: 10, severity: 'error' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result).toHaveLength(1)
    })

    it('should handle reviews with null/invalid findings', () => {
      const reviews: SubAgentReview[] = [
        { agentId: 'agent-1', findings: null as unknown as Finding[], timestamp: Date.now() },
        {
          agentId: 'agent-2',
          findings: [{ file: 'test.ts', line: 10, severity: 'error' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result).toHaveLength(1)
    })

    it('should merge aiPrompt when present in one agent', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', title: 'Bug' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-2',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', title: 'Bug', aiPrompt: 'Fix this bug' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result[0].aiPrompt).toBe('Fix this bug')
    })

    it('should merge codeChange when present in one agent', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', title: 'Bug' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-2',
          findings: [
            {
              file: 'test.ts',
              line: 10,
              severity: 'error',
              title: 'Bug',
              codeChange: { oldCode: 'old', newCode: 'new' }
            }
          ],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result[0].codeChange).toEqual({ oldCode: 'old', newCode: 'new' })
    })

    it('should use case-insensitive matching for deduplication', () => {
      const reviews: SubAgentReview[] = [
        {
          agentId: 'agent-1',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', category: 'Security', title: 'SQL Injection' }],
          timestamp: Date.now()
        },
        {
          agentId: 'agent-2',
          findings: [{ file: 'test.ts', line: 10, severity: 'error', category: 'SECURITY', title: 'sql injection' }],
          timestamp: Date.now()
        }
      ]

      const result = consolidateFindings(reviews)

      expect(result).toHaveLength(1)
      expect(result[0].sourceAgents).toContain('agent-1')
      expect(result[0].sourceAgents).toContain('agent-2')
    })
  })

  describe('filterVerifiedFindings', () => {
    const sampleFindings: Finding[] = [
      { file: 'test.ts', line: 10, severity: 'error' },
      { file: 'test.ts', line: 20, severity: 'warning' },
      { file: 'test.ts', line: 30, severity: 'critical' }
    ]

    it('should return empty array for empty findings', () => {
      expect(filterVerifiedFindings([], [])).toEqual([])
    })

    it('should return empty array when no verification results', () => {
      expect(filterVerifiedFindings(sampleFindings, [])).toEqual([])
    })

    it('should filter to only verified findings', () => {
      const verificationResults = [
        { index: 0, status: 'verified' as const },
        { index: 1, status: 'rejected' as const },
        { index: 2, status: 'verified' as const }
      ]

      const result = filterVerifiedFindings(sampleFindings, verificationResults)

      expect(result).toHaveLength(2)
      expect(result[0].line).toBe(10)
      expect(result[1].line).toBe(30)
    })

    it('should set verificationStatus on filtered findings', () => {
      const verificationResults = [{ index: 0, status: 'verified' as const }]

      const result = filterVerifiedFindings(sampleFindings, verificationResults)

      expect(result[0].verificationStatus).toBe('verified')
    })

    it('should handle verification results with missing indices', () => {
      const verificationResults = [
        { index: 0, status: 'verified' as const }
        // Missing index 1 and 2
      ]

      const result = filterVerifiedFindings(sampleFindings, verificationResults)

      expect(result).toHaveLength(1)
      expect(result[0].line).toBe(10)
    })

    it('should handle out-of-bounds indices', () => {
      const verificationResults = [
        { index: 0, status: 'verified' as const },
        { index: 100, status: 'verified' as const } // Out of bounds
      ]

      const result = filterVerifiedFindings(sampleFindings, verificationResults)

      expect(result).toHaveLength(1)
    })

    it('should handle null/undefined input gracefully', () => {
      expect(filterVerifiedFindings(null as unknown as Finding[], [])).toEqual([])
      expect(filterVerifiedFindings([], null as unknown as [])).toEqual([])
    })

    it('should handle invalid verification result objects', () => {
      const verificationResults = [
        { index: 0, status: 'verified' as const },
        { status: 'verified' } as unknown as { index: number; status: 'verified' }, // Missing index
        null as unknown as { index: number; status: 'verified' }
      ]

      const result = filterVerifiedFindings(sampleFindings, verificationResults)

      expect(result).toHaveLength(1)
    })

    it('should preserve all finding properties', () => {
      const findings: Finding[] = [
        {
          file: 'test.ts',
          line: 10,
          severity: 'error',
          category: 'Security',
          title: 'Bug',
          description: 'Description',
          confidence: 0.9,
          sourceAgents: ['agent-1']
        }
      ]

      const verificationResults = [{ index: 0, status: 'verified' as const }]

      const result = filterVerifiedFindings(findings, verificationResults)

      expect(result[0]).toMatchObject({
        file: 'test.ts',
        line: 10,
        severity: 'error',
        category: 'Security',
        title: 'Bug',
        description: 'Description',
        confidence: 0.9,
        sourceAgents: ['agent-1'],
        verificationStatus: 'verified'
      })
    })
  })

  describe('generateFindingId', () => {
    it('should generate consistent IDs', () => {
      const id = generateFindingId('review-123', 0, 5)

      expect(id).toBe('review-123-highrisk-0-5')
    })

    it('should generate unique IDs for different inputs', () => {
      const id1 = generateFindingId('review-123', 0, 0)
      const id2 = generateFindingId('review-123', 0, 1)
      const id3 = generateFindingId('review-123', 1, 0)
      const id4 = generateFindingId('review-456', 0, 0)

      expect(new Set([id1, id2, id3, id4]).size).toBe(4)
    })
  })
})
