import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { resolve } from 'path'

// Load the actual hook functions — the .cjs file guards main() behind
// require.main === module, so requiring it just gives us the exports.
const req = createRequire(import.meta.url)
const { tokenizeCommand, matchesBashRule } = req(
  resolve(__dirname, '../../resources/bin/permission-handler.cjs')
) as {
  tokenizeCommand: (command: string) => string[]
  matchesBashRule: (command: string, bashRules: (string[] | null)[]) => boolean
}

describe('tokenizeCommand', () => {
  it('splits simple commands into tokens', () => {
    expect(tokenizeCommand('git status')).toEqual(['git', 'status'])
    expect(tokenizeCommand('git push origin main')).toEqual(['git', 'push', 'origin', 'main'])
    expect(tokenizeCommand('ls -la')).toEqual(['ls', '-la'])
    expect(tokenizeCommand('rm -rf node_modules')).toEqual(['rm', '-rf', 'node_modules'])
  })

  it('handles extra whitespace', () => {
    expect(tokenizeCommand('  git   status  ')).toEqual(['git', 'status'])
    expect(tokenizeCommand('git\tstatus')).toEqual(['git', 'status'])
  })

  it('handles single-quoted strings as one token', () => {
    expect(tokenizeCommand("echo 'hello world'")).toEqual(['echo', "'hello world'"])
    expect(tokenizeCommand("git commit -m 'fix bug'")).toEqual(['git', 'commit', '-m', "'fix bug'"])
  })

  it('handles double-quoted strings as one token', () => {
    expect(tokenizeCommand('echo "hello world"')).toEqual(['echo', '"hello world"'])
    expect(tokenizeCommand('git commit -m "fix bug"')).toEqual(['git', 'commit', '-m', '"fix bug"'])
  })

  it('handles escaped characters', () => {
    expect(tokenizeCommand('echo hello\\ world')).toEqual(['echo', 'hello\\ world'])
  })

  it('handles empty string', () => {
    expect(tokenizeCommand('')).toEqual([])
    expect(tokenizeCommand('   ')).toEqual([])
  })

  it('handles single token', () => {
    expect(tokenizeCommand('ls')).toEqual(['ls'])
  })

  it('handles commands with paths', () => {
    expect(tokenizeCommand('cat /etc/hosts')).toEqual(['cat', '/etc/hosts'])
    expect(tokenizeCommand('rm -rf /tmp/build')).toEqual(['rm', '-rf', '/tmp/build'])
  })

  it('handles chained commands as single tokens (not split on operators)', () => {
    expect(tokenizeCommand('git add . && git commit -m "test"')).toEqual([
      'git', 'add', '.', '&&', 'git', 'commit', '-m', '"test"'
    ])
  })

  it('handles pipe operators as tokens', () => {
    expect(tokenizeCommand('cat file.txt | grep error')).toEqual([
      'cat', 'file.txt', '|', 'grep', 'error'
    ])
  })

  it('handles semicolons as part of tokens', () => {
    expect(tokenizeCommand('echo hello;')).toEqual(['echo', 'hello;'])
  })
})

describe('matchesBashRule', () => {
  describe('exact match behavior', () => {
    it('matches when command tokens exactly equal a rule', () => {
      const rules = [['git', 'status']]
      expect(matchesBashRule('git status', rules)).toBe(true)
    })

    it('does not match when command has extra tokens', () => {
      const rules = [['git', 'reset']]
      expect(matchesBashRule('git reset --hard', rules)).toBe(false)
    })

    it('does not match when command has fewer tokens', () => {
      const rules = [['git', 'push', 'origin', 'main']]
      expect(matchesBashRule('git push', rules)).toBe(false)
    })

    it('does not match when tokens differ', () => {
      const rules = [['git', 'pull']]
      expect(matchesBashRule('git push', rules)).toBe(false)
    })
  })

  describe('the core use case: git reset vs git reset --hard', () => {
    it('allows "git reset" but not "git reset --hard"', () => {
      const rules = [['git', 'reset']]
      expect(matchesBashRule('git reset', rules)).toBe(true)
      expect(matchesBashRule('git reset --hard', rules)).toBe(false)
      expect(matchesBashRule('git reset --hard HEAD~1', rules)).toBe(false)
      expect(matchesBashRule('git reset --soft HEAD~1', rules)).toBe(false)
    })

    it('allows "git reset --soft" specifically if that rule exists', () => {
      const rules = [['git', 'reset', '--soft']]
      expect(matchesBashRule('git reset --soft', rules)).toBe(true)
      expect(matchesBashRule('git reset --hard', rules)).toBe(false)
      expect(matchesBashRule('git reset', rules)).toBe(false)
    })
  })

  describe('multiple rules', () => {
    it('matches if any rule matches', () => {
      const rules = [
        ['git', 'status'],
        ['git', 'log'],
        ['npm', 'test'],
      ]
      expect(matchesBashRule('git status', rules)).toBe(true)
      expect(matchesBashRule('git log', rules)).toBe(true)
      expect(matchesBashRule('npm test', rules)).toBe(true)
      expect(matchesBashRule('git push', rules)).toBe(false)
      expect(matchesBashRule('rm -rf /', rules)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('returns false with empty rules', () => {
      expect(matchesBashRule('git status', [])).toBe(false)
    })

    it('returns false with empty command', () => {
      expect(matchesBashRule('', [['git', 'status']])).toBe(false)
    })

    it('handles whitespace in command', () => {
      const rules = [['git', 'status']]
      expect(matchesBashRule('  git   status  ', rules)).toBe(true)
    })

    it('skips invalid rules (not arrays, empty arrays)', () => {
      const rules: (string[] | null)[] = [
        null,
        [],
        ['git', 'status'],
      ]
      expect(matchesBashRule('git status', rules)).toBe(true)
      expect(matchesBashRule('ls', rules)).toBe(false)
    })

    it('is case-sensitive', () => {
      const rules = [['git', 'status']]
      expect(matchesBashRule('GIT status', rules)).toBe(false)
      expect(matchesBashRule('git STATUS', rules)).toBe(false)
    })
  })

  describe('real-world scenarios', () => {
    const rules = [
      ['git', 'status'],
      ['git', 'diff'],
      ['git', 'log'],
      ['git', 'pull'],
      ['git', 'fetch'],
      ['ls', '-la'],
      ['npm', 'test'],
      ['npm', 'run', 'build'],
      ['npx', 'tsc', '--noEmit'],
    ]

    it('allows safe git commands', () => {
      expect(matchesBashRule('git status', rules)).toBe(true)
      expect(matchesBashRule('git diff', rules)).toBe(true)
      expect(matchesBashRule('git log', rules)).toBe(true)
      expect(matchesBashRule('git pull', rules)).toBe(true)
      expect(matchesBashRule('git fetch', rules)).toBe(true)
    })

    it('blocks dangerous git commands not in rules', () => {
      expect(matchesBashRule('git push', rules)).toBe(false)
      expect(matchesBashRule('git push --force', rules)).toBe(false)
      expect(matchesBashRule('git reset --hard', rules)).toBe(false)
      expect(matchesBashRule('git checkout .', rules)).toBe(false)
      expect(matchesBashRule('git clean -fd', rules)).toBe(false)
    })

    it('blocks destructive commands', () => {
      expect(matchesBashRule('rm -rf /', rules)).toBe(false)
      expect(matchesBashRule('rm -rf node_modules', rules)).toBe(false)
      expect(matchesBashRule('sudo rm -rf /', rules)).toBe(false)
    })

    it('allows build commands', () => {
      expect(matchesBashRule('npm test', rules)).toBe(true)
      expect(matchesBashRule('npm run build', rules)).toBe(true)
      expect(matchesBashRule('npx tsc --noEmit', rules)).toBe(true)
    })

    it('blocks build commands with extra args not in rules', () => {
      expect(matchesBashRule('npm test --coverage', rules)).toBe(false)
      expect(matchesBashRule('npm run build --watch', rules)).toBe(false)
    })

    it('git pull does not match git pull origin main (exact match)', () => {
      expect(matchesBashRule('git pull', rules)).toBe(true)
      expect(matchesBashRule('git pull origin main', rules)).toBe(false)
    })
  })

  describe('quoted string matching', () => {
    it('matches commands with double-quoted arguments', () => {
      const rules = [['git', 'commit', '-m', '"fix bug"']]
      expect(matchesBashRule('git commit -m "fix bug"', rules)).toBe(true)
      expect(matchesBashRule('git commit -m "other msg"', rules)).toBe(false)
    })

    it('matches commands with single-quoted arguments', () => {
      const rules = [['echo', "'hello world'"]]
      expect(matchesBashRule("echo 'hello world'", rules)).toBe(true)
      expect(matchesBashRule("echo 'goodbye'", rules)).toBe(false)
    })

    it('quoted tokens do not match unquoted equivalents', () => {
      // The rule has quotes preserved; the command without quotes tokenizes differently
      const rules = [['git', 'commit', '-m', '"fix bug"']]
      // Without quotes, "fix" and "bug" would be separate tokens → 5 tokens ≠ 4
      expect(matchesBashRule('git commit -m fix bug', rules)).toBe(false)
    })
  })

  describe('wildcard (*) suffix matching', () => {
    it('matches any command that starts with the prefix tokens', () => {
      const rules = [['git', 'reset', '*']]
      expect(matchesBashRule('git reset', rules)).toBe(true)
      expect(matchesBashRule('git reset --hard', rules)).toBe(true)
      expect(matchesBashRule('git reset --soft HEAD~1', rules)).toBe(true)
      expect(matchesBashRule('git reset --hard HEAD~3', rules)).toBe(true)
    })

    it('does not match if the prefix tokens differ', () => {
      const rules = [['git', 'reset', '*']]
      expect(matchesBashRule('git push origin main', rules)).toBe(false)
      expect(matchesBashRule('git status', rules)).toBe(false)
    })

    it('does not match if command has fewer tokens than the prefix', () => {
      const rules = [['git', 'reset', '*']]
      expect(matchesBashRule('git', rules)).toBe(false)
    })

    it('matches with a single-token prefix + wildcard', () => {
      const rules = [['npm', '*']]
      expect(matchesBashRule('npm test', rules)).toBe(true)
      expect(matchesBashRule('npm run build', rules)).toBe(true)
      expect(matchesBashRule('npm install --save-dev typescript', rules)).toBe(true)
      expect(matchesBashRule('npm', rules)).toBe(true)
    })

    it('does not match a different base command', () => {
      const rules = [['npm', '*']]
      expect(matchesBashRule('yarn test', rules)).toBe(false)
    })

    it('works alongside exact rules', () => {
      const rules = [
        ['git', 'status'],        // exact
        ['git', 'log', '*'],      // wildcard
        ['npm', 'test'],          // exact
      ]
      expect(matchesBashRule('git status', rules)).toBe(true)
      expect(matchesBashRule('git status --short', rules)).toBe(false) // exact, no extra args
      expect(matchesBashRule('git log', rules)).toBe(true)
      expect(matchesBashRule('git log --oneline', rules)).toBe(true)
      expect(matchesBashRule('git log --oneline --graph', rules)).toBe(true)
      expect(matchesBashRule('npm test', rules)).toBe(true)
      expect(matchesBashRule('npm test --coverage', rules)).toBe(false) // exact, no extra args
    })

    it('handles wildcard-only rule (matches everything)', () => {
      const rules = [['*']]
      // prefix length = 0, so any command with >= 0 tokens matches
      expect(matchesBashRule('anything', rules)).toBe(true)
      expect(matchesBashRule('rm -rf /', rules)).toBe(true)
    })

    it('handles whitespace with wildcard rules', () => {
      const rules = [['git', 'log', '*']]
      expect(matchesBashRule('  git   log  --oneline  ', rules)).toBe(true)
    })

    it('skips invalid wildcard rules', () => {
      const rules: (string[] | null)[] = [null, [], ['git', 'log', '*']]
      expect(matchesBashRule('git log --all', rules)).toBe(true)
      expect(matchesBashRule('git push', rules)).toBe(false)
    })
  })

  describe('command chaining and shell operators', () => {
    it('chained commands do not match simple rules', () => {
      const rules = [['git', 'status']]
      expect(matchesBashRule('git status && rm -rf /', rules)).toBe(false)
      expect(matchesBashRule('git status ; echo done', rules)).toBe(false)
      expect(matchesBashRule('git status | cat', rules)).toBe(false)
    })

    it('chained commands are allowed only if each sub-command matches a rule', () => {
      const rules = [
        ['git', 'add', '*'],
        ['git', 'commit', '*'],
      ]
      // Both sub-commands match rules
      expect(matchesBashRule('git add . && git commit -m "update"', rules)).toBe(true)
      // git push has no matching rule
      expect(matchesBashRule('git add . && git push', rules)).toBe(false)
    })
  })

  describe('wildcard rules must not bypass via command chaining', () => {
    // This is the critical security scenario: a wildcard rule like ["cd", "*"]
    // should NOT auto-allow everything chained after cd via && or ;
    // Real-world: Claude CLI sends "cd /project && git push origin main"

    const rules = [
      ['cd', '*'],
      ['cat', '*'],
      ['grep', '*'],
      ['ls', '*'],
    ]

    it('cd wildcard must NOT allow chained git commands via &&', () => {
      expect(matchesBashRule('cd /c/git/project && git status', rules)).toBe(false)
      expect(matchesBashRule('cd /c/git/project && git push origin main', rules)).toBe(false)
      expect(matchesBashRule('cd /c/git/project && git commit -m "msg"', rules)).toBe(false)
      expect(matchesBashRule('cd /c/git/project && git reset --hard', rules)).toBe(false)
      expect(matchesBashRule('cd /c/git/project && git add . && git push', rules)).toBe(false)
    })

    it('cd wildcard must NOT allow chained destructive commands via &&', () => {
      expect(matchesBashRule('cd /tmp && rm -rf /', rules)).toBe(false)
      expect(matchesBashRule('cd /project && npx tsc --noEmit', rules)).toBe(false)
      expect(matchesBashRule('cd /project && npm run build', rules)).toBe(false)
    })

    it('cd wildcard must NOT allow chained commands via ;', () => {
      expect(matchesBashRule('cd /project ; git push --force', rules)).toBe(false)
      expect(matchesBashRule('cd /project ; rm -rf .', rules)).toBe(false)
    })

    it('cd wildcard must NOT allow chained commands via ||', () => {
      expect(matchesBashRule('cd /project || echo fail', rules)).toBe(false)
    })

    it('cd wildcard must NOT allow piped commands', () => {
      expect(matchesBashRule('cd /project | malicious-command', rules)).toBe(false)
    })

    it('cat wildcard must NOT allow chained destructive commands', () => {
      expect(matchesBashRule('cat file.txt && rm -rf /', rules)).toBe(false)
      expect(matchesBashRule('cat file.txt ; echo pwned', rules)).toBe(false)
    })

    it('grep wildcard must NOT allow chained commands', () => {
      expect(matchesBashRule('grep -r pattern . && git push --force', rules)).toBe(false)
    })

    it('plain cd (no chain) should still be allowed by wildcard', () => {
      expect(matchesBashRule('cd /project', rules)).toBe(true)
      expect(matchesBashRule('cd /some/deep/path', rules)).toBe(true)
      expect(matchesBashRule('cd', rules)).toBe(true)
    })

    it('plain cat/ls/grep (no chain) should still be allowed by wildcard', () => {
      expect(matchesBashRule('cat file.txt', rules)).toBe(true)
      expect(matchesBashRule('cat /etc/hosts', rules)).toBe(true)
      expect(matchesBashRule('ls -la /tmp', rules)).toBe(true)
      expect(matchesBashRule('grep -rn pattern src/', rules)).toBe(true)
    })

    it('wildcard rules for multi-token prefixes still work with chains blocked', () => {
      const multiRules = [['git', 'log', '*']]
      expect(matchesBashRule('git log --oneline', multiRules)).toBe(true)
      expect(matchesBashRule('git log --oneline && rm -rf /', multiRules)).toBe(false)
      expect(matchesBashRule('git log ; echo done', multiRules)).toBe(false)
    })
  })
})

describe('allowlist format migration', () => {
  function parseAllowlist(data: unknown): { tools: string[]; bashRules: string[][] } {
    if (Array.isArray(data)) {
      return { tools: data, bashRules: [] }
    }
    const obj = data as Record<string, unknown>
    return {
      tools: Array.isArray(obj.tools) ? obj.tools as string[] : [],
      bashRules: Array.isArray(obj.bashRules) ? obj.bashRules as string[][] : [],
    }
  }

  it('legacy format: plain array becomes { tools, bashRules: [] }', () => {
    const result = parseAllowlist(['Edit', 'Write', 'Bash'])
    expect(result).toEqual({ tools: ['Edit', 'Write', 'Bash'], bashRules: [] })
  })

  it('new format: object with tools and bashRules', () => {
    const result = parseAllowlist({
      tools: ['Edit', 'Write'],
      bashRules: [['git', 'status'], ['npm', 'test']],
    })
    expect(result).toEqual({
      tools: ['Edit', 'Write'],
      bashRules: [['git', 'status'], ['npm', 'test']],
    })
  })

  it('handles missing fields gracefully', () => {
    expect(parseAllowlist({})).toEqual({ tools: [], bashRules: [] })
    expect(parseAllowlist({ tools: ['Edit'] })).toEqual({ tools: ['Edit'], bashRules: [] })
    expect(parseAllowlist({ bashRules: [['ls']] })).toEqual({ tools: [], bashRules: [['ls']] })
  })

  it('handles null/undefined gracefully', () => {
    expect(parseAllowlist({ tools: null, bashRules: null })).toEqual({ tools: [], bashRules: [] })
  })
})
