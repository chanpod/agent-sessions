/**
 * Tests for Package Scripts Service
 *
 * Tests the functionality extracted from main.ts for discovering
 * package.json files and detecting package managers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  findPackageJsonFiles,
  detectPackageManager,
  buildRemotePackageScript,
  getPackageScriptsLocal,
} from '../services/package-scripts'

describe('Package Scripts Service', () => {
  let tempDir: string

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tempDir = path.join(os.tmpdir(), `package-scripts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.promises.mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('findPackageJsonFiles', () => {
    it('should find package.json in root directory', async () => {
      // Create a package.json in the root
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project', scripts: { test: 'echo test' } })
      )

      const result = await findPackageJsonFiles(tempDir, tempDir)

      expect(result).toContain('.')
      expect(result).toHaveLength(1)
    })

    it('should find package.json in nested directories', async () => {
      // Create root package.json
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'root-project' })
      )

      // Create nested package
      const nestedDir = path.join(tempDir, 'packages', 'sub-package')
      await fs.promises.mkdir(nestedDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(nestedDir, 'package.json'),
        JSON.stringify({ name: 'sub-package' })
      )

      const result = await findPackageJsonFiles(tempDir, tempDir)

      expect(result).toContain('.')
      expect(result).toContain(path.join('packages', 'sub-package'))
      expect(result).toHaveLength(2)
    })

    it('should skip node_modules directories', async () => {
      // Create root package.json
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' })
      )

      // Create node_modules with a package
      const nodeModulesDir = path.join(tempDir, 'node_modules', 'some-dep')
      await fs.promises.mkdir(nodeModulesDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(nodeModulesDir, 'package.json'),
        JSON.stringify({ name: 'some-dep' })
      )

      const result = await findPackageJsonFiles(tempDir, tempDir)

      expect(result).toContain('.')
      expect(result).toHaveLength(1)
      // Should not include anything from node_modules
      expect(result.some(p => p.includes('node_modules'))).toBe(false)
    })

    it('should skip .git directories', async () => {
      // Create root package.json
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' })
      )

      // Create .git with something that looks like a package
      const gitDir = path.join(tempDir, '.git', 'hooks')
      await fs.promises.mkdir(gitDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(tempDir, '.git', 'package.json'),
        JSON.stringify({ name: 'git-package' })
      )

      const result = await findPackageJsonFiles(tempDir, tempDir)

      expect(result).toContain('.')
      expect(result).toHaveLength(1)
      expect(result.some(p => p.includes('.git'))).toBe(false)
    })

    it('should skip dist directories', async () => {
      // Create root package.json
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project' })
      )

      // Create dist with a package
      const distDir = path.join(tempDir, 'dist')
      await fs.promises.mkdir(distDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(distDir, 'package.json'),
        JSON.stringify({ name: 'dist-package' })
      )

      const result = await findPackageJsonFiles(tempDir, tempDir)

      expect(result).toContain('.')
      expect(result).toHaveLength(1)
      expect(result.some(p => p.includes('dist'))).toBe(false)
    })

    it('should respect max depth limit', async () => {
      // Create deeply nested structure
      let currentDir = tempDir
      for (let i = 0; i < 15; i++) {
        currentDir = path.join(currentDir, `level${i}`)
        await fs.promises.mkdir(currentDir, { recursive: true })
        await fs.promises.writeFile(
          path.join(currentDir, 'package.json'),
          JSON.stringify({ name: `level-${i}` })
        )
      }

      // Use maxDepth of 5
      const result = await findPackageJsonFiles(tempDir, tempDir, 0, 5)

      // Should only find packages up to depth 5
      expect(result.length).toBeLessThan(15)
      expect(result.length).toBeLessThanOrEqual(6) // 0 through 5
    })

    it('should handle empty directories gracefully', async () => {
      const result = await findPackageJsonFiles(tempDir, tempDir)
      expect(result).toEqual([])
    })

    it('should handle directories with no access gracefully', async () => {
      // This test verifies the function doesn't throw on inaccessible dirs
      const nonExistentDir = path.join(tempDir, 'non-existent')
      const result = await findPackageJsonFiles(nonExistentDir, nonExistentDir)
      expect(result).toEqual([])
    })
  })

  describe('detectPackageManager', () => {
    it('should detect pnpm from pnpm-lock.yaml', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), '')

      const result = await detectPackageManager(tempDir)

      expect(result).toBe('pnpm')
    })

    it('should detect yarn from yarn.lock', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'yarn.lock'), '')

      const result = await detectPackageManager(tempDir)

      expect(result).toBe('yarn')
    })

    it('should detect bun from bun.lockb', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'bun.lockb'), '')

      const result = await detectPackageManager(tempDir)

      expect(result).toBe('bun')
    })

    it('should default to npm when no lock file is present', async () => {
      const result = await detectPackageManager(tempDir)

      expect(result).toBe('npm')
    })

    it('should prioritize pnpm over yarn when both present', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), '')
      await fs.promises.writeFile(path.join(tempDir, 'yarn.lock'), '')

      const result = await detectPackageManager(tempDir)

      expect(result).toBe('pnpm')
    })

    it('should prioritize yarn over bun when both present (but no pnpm)', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'yarn.lock'), '')
      await fs.promises.writeFile(path.join(tempDir, 'bun.lockb'), '')

      const result = await detectPackageManager(tempDir)

      expect(result).toBe('yarn')
    })
  })

  describe('buildRemotePackageScript', () => {
    it('should generate a valid Node.js script', () => {
      const projectPath = '/home/user/project'
      const script = buildRemotePackageScript(projectPath)

      // Should be a node -e command
      expect(script).toContain('node -e')

      // Should include the project path
      expect(script).toContain(projectPath)

      // Should have exclude dirs
      expect(script).toContain('node_modules')
      expect(script).toContain('.git')

      // Should have package detection logic
      expect(script).toContain('findPackageJsonFiles')
      expect(script).toContain('detectPackageManager')
    })

    it('should escape the project path properly for different paths', () => {
      const projectPath = "/home/user/my project"
      const script = buildRemotePackageScript(projectPath)

      // Path should be included
      expect(script).toContain(projectPath)
    })
  })

  describe('getPackageScriptsLocal', () => {
    it('should return hasPackageJson: false when no package.json exists', async () => {
      const result = await getPackageScriptsLocal(tempDir, tempDir)

      expect(result.hasPackageJson).toBe(false)
      expect(result.packages).toEqual([])
      expect(result.scripts).toEqual([])
    })

    it('should return scripts from package.json', async () => {
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'vitest',
            build: 'tsc',
            dev: 'vite',
          },
        })
      )

      const result = await getPackageScriptsLocal(tempDir, tempDir)

      expect(result.hasPackageJson).toBe(true)
      expect(result.scripts).toHaveLength(3)
      expect(result.scripts).toContainEqual({ name: 'test', command: 'vitest' })
      expect(result.scripts).toContainEqual({ name: 'build', command: 'tsc' })
      expect(result.scripts).toContainEqual({ name: 'dev', command: 'vite' })
    })

    it('should detect package manager correctly', async () => {
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', scripts: { test: 'echo test' } })
      )
      await fs.promises.writeFile(path.join(tempDir, 'yarn.lock'), '')

      const result = await getPackageScriptsLocal(tempDir, tempDir)

      expect(result.packageManager).toBe('yarn')
    })

    it('should include project name from package.json', async () => {
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'my-awesome-project', scripts: { test: 'echo test' } })
      )

      const result = await getPackageScriptsLocal(tempDir, tempDir)

      expect(result.projectName).toBe('my-awesome-project')
    })

    it('should find packages in monorepo structure', async () => {
      // Create root package.json
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'monorepo',
          scripts: { test: 'turbo test' },
        })
      )

      // Create a package in packages/
      const pkg1Dir = path.join(tempDir, 'packages', 'pkg1')
      await fs.promises.mkdir(pkg1Dir, { recursive: true })
      await fs.promises.writeFile(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify({
          name: '@monorepo/pkg1',
          scripts: { build: 'tsc' },
        })
      )

      // Create another package
      const pkg2Dir = path.join(tempDir, 'packages', 'pkg2')
      await fs.promises.mkdir(pkg2Dir, { recursive: true })
      await fs.promises.writeFile(
        path.join(pkg2Dir, 'package.json'),
        JSON.stringify({
          name: '@monorepo/pkg2',
          scripts: { dev: 'vite' },
        })
      )

      const result = await getPackageScriptsLocal(tempDir, tempDir)

      expect(result.hasPackageJson).toBe(true)
      expect(result.packages).toHaveLength(3) // root + 2 packages

      // Check that we found all packages
      const packagePaths = result.packages.map(p => p.packagePath)
      expect(packagePaths).toContain('.')
      expect(packagePaths).toContain(path.join('packages', 'pkg1'))
      expect(packagePaths).toContain(path.join('packages', 'pkg2'))
    })

    it('should exclude packages with no scripts', async () => {
      // Create root package.json with scripts
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'root',
          scripts: { test: 'echo test' },
        })
      )

      // Create a package without scripts
      const noScriptsDir = path.join(tempDir, 'packages', 'no-scripts')
      await fs.promises.mkdir(noScriptsDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(noScriptsDir, 'package.json'),
        JSON.stringify({
          name: 'no-scripts-package',
          // No scripts field
        })
      )

      // Create a package with empty scripts
      const emptyScriptsDir = path.join(tempDir, 'packages', 'empty-scripts')
      await fs.promises.mkdir(emptyScriptsDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(emptyScriptsDir, 'package.json'),
        JSON.stringify({
          name: 'empty-scripts-package',
          scripts: {},
        })
      )

      const result = await getPackageScriptsLocal(tempDir, tempDir)

      // Should only include root which has scripts
      expect(result.packages).toHaveLength(1)
      expect(result.packages[0].packagePath).toBe('.')
    })

    it('should handle invalid JSON in package.json gracefully', async () => {
      // Create valid root package.json
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'root',
          scripts: { test: 'echo test' },
        })
      )

      // Create a subdirectory with invalid JSON
      const invalidDir = path.join(tempDir, 'packages', 'invalid')
      await fs.promises.mkdir(invalidDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(invalidDir, 'package.json'),
        '{ invalid json }'
      )

      // Should not throw
      const result = await getPackageScriptsLocal(tempDir, tempDir)

      expect(result.hasPackageJson).toBe(true)
      // Should only include root, invalid package should be skipped
      expect(result.packages).toHaveLength(1)
    })
  })
})
