/**
 * Package Scripts Service
 *
 * Extracted from main.ts to handle package.json script discovery.
 * Supports local, WSL, and SSH remote execution.
 */

import * as fs from 'fs'
import type { SSHManager } from '../ssh-manager.js'
import { CONSTANTS } from '../constants.js'
import { PathService } from '../utils/path-service.js'

/**
 * Information about a single npm script
 */
export interface ScriptInfo {
  name: string
  command: string
}

/**
 * Information about scripts in a package.json
 */
export interface PackageScripts {
  packagePath: string
  packageName?: string
  scripts: ScriptInfo[]
  packageManager?: string
}

/**
 * Result of getting package scripts
 */
export interface PackageScriptResult {
  hasPackageJson: boolean
  packages: PackageScripts[]
  scripts: ScriptInfo[]  // Legacy field for backward compatibility
  packageManager?: string
  projectName?: string
  error?: string
}

/**
 * Directories to exclude when searching for package.json files
 */
const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo']

/**
 * Find all package.json files in a directory tree
 *
 * @param dir - Current directory to search
 * @param rootDir - Root directory for calculating relative paths
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum recursion depth
 * @returns Array of relative paths to directories containing package.json
 */
export async function findPackageJsonFiles(
  dir: string,
  rootDir: string,
  depth: number = 0,
  maxDepth: number = CONSTANTS.MAX_DIRECTORY_DEPTH
): Promise<string[]> {
  if (depth > maxDepth) return [] // Prevent infinite recursion

  const results: string[] = []

  try {
    const packageJsonPath = PathService.join(dir, 'package.json')
    try {
      await fs.promises.access(packageJsonPath)
      const relativePath = PathService.relative(rootDir, dir)
      results.push(relativePath || '.')
    } catch {
      // package.json doesn't exist in this directory
    }

    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    // Process subdirectories in parallel for better performance
    const subdirPromises: Promise<string[]>[] = []
    for (const entry of entries) {
      if (entry.isDirectory() && !EXCLUDE_DIRS.includes(entry.name)) {
        const subdirPath = PathService.join(dir, entry.name)
        subdirPromises.push(findPackageJsonFiles(subdirPath, rootDir, depth + 1, maxDepth))
      }
    }
    const subdirResults = await Promise.all(subdirPromises)
    for (const subResults of subdirResults) {
      results.push(...subResults)
    }
  } catch {
    // Ignore errors for directories we can't read
  }

  return results
}

/**
 * Detect which package manager is used in a directory
 *
 * @param dir - Directory to check for lock files
 * @returns Package manager name: 'pnpm', 'yarn', 'bun', or 'npm'
 */
export async function detectPackageManager(dir: string): Promise<string> {
  const checkFile = async (filename: string): Promise<boolean> => {
    try {
      await fs.promises.access(PathService.join(dir, filename))
      return true
    } catch {
      return false
    }
  }

  // Check all lock files in parallel
  const [hasPnpm, hasYarn, hasBun] = await Promise.all([
    checkFile('pnpm-lock.yaml'),
    checkFile('yarn.lock'),
    checkFile('bun.lockb'),
  ])

  if (hasPnpm) return 'pnpm'
  if (hasYarn) return 'yarn'
  if (hasBun) return 'bun'
  return 'npm'
}

/**
 * Build the Node.js script for remote execution via SSH
 *
 * This creates a self-contained Node.js script that can be executed
 * on a remote machine to find package.json files and extract scripts.
 *
 * @param projectPath - The remote project path
 * @returns A Node.js script string ready for execution
 */
export function buildRemotePackageScript(projectPath: string): string {
  return `node -e "
const fs = require('fs');
const path = require('path');

const rootDir = '${projectPath}';
const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo'];

function findPackageJsonFiles(dir, depth = 0) {
  if (depth > 10) return [];
  const results = [];

  try {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      results.push(dir);
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
        results.push(...findPackageJsonFiles(path.join(dir, entry.name), depth + 1));
      }
    }
  } catch (err) {
    // Ignore errors
  }

  return results;
}

function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

try {
  if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
    console.log(JSON.stringify({ hasPackageJson: false, packages: [], scripts: [] }));
    process.exit(0);
  }

  const packageDirs = findPackageJsonFiles(rootDir);
  const packages = [];

  for (const pkgDir of packageDirs) {
    try {
      const pkgPath = path.join(pkgDir, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(content);

      if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
        const scripts = Object.entries(pkg.scripts).map(([name, command]) => ({ name, command }));
        const relativePath = path.relative(rootDir, pkgDir) || '.';

        packages.push({
          packagePath: relativePath,
          packageName: pkg.name || '',
          scripts: scripts,
          packageManager: detectPackageManager(pkgDir)
        });
      }
    } catch (err) {
      // Ignore individual package errors
    }
  }

  console.log(JSON.stringify({ hasPackageJson: true, packages, scripts: [] }));
} catch (err) {
  console.error(JSON.stringify({ hasPackageJson: false, packages: [], scripts: [], error: err.message }));
  process.exit(1);
}
"`
}

/**
 * Get package scripts from a local or WSL filesystem
 *
 * @param fsPath - The filesystem path (already resolved for WSL if needed)
 * @param originalProjectPath - The original project path (for display/project name)
 * @returns Package script result
 */
export async function getPackageScriptsLocal(
  fsPath: string,
  originalProjectPath: string
): Promise<PackageScriptResult> {
  const rootPackageJsonPath = PathService.join(fsPath, 'package.json')

  // Check if root package.json exists
  try {
    await fs.promises.access(rootPackageJsonPath)
  } catch {
    return { hasPackageJson: false, packages: [], scripts: [] }
  }

  // Find all package.json files in the project (async)
  const packagePaths = await findPackageJsonFiles(fsPath, fsPath)
  const packages: PackageScripts[] = []

  // Read and process each package.json in parallel
  const packagePromises = packagePaths.map(async (relativePath) => {
    try {
      const packageDir = PathService.join(fsPath, relativePath)
      const packageJsonPath = PathService.join(packageDir, 'package.json')
      const content = await fs.promises.readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(content)

      const scripts: ScriptInfo[] = []
      if (packageJson.scripts && typeof packageJson.scripts === 'object') {
        for (const [name, command] of Object.entries(packageJson.scripts)) {
          if (typeof command === 'string') {
            scripts.push({ name, command })
          }
        }
      }

      // Only include packages that have scripts
      if (scripts.length > 0) {
        return {
          packagePath: relativePath,
          packageName: packageJson.name,
          scripts,
          packageManager: await detectPackageManager(packageDir),
        }
      }
      return null
    } catch (err) {
      console.error(`Failed to read package.json at ${relativePath}:`, err)
      return null
    }
  })

  const packageResults = await Promise.all(packagePromises)
  for (const pkg of packageResults) {
    if (pkg) packages.push(pkg)
  }

  // Get legacy fields from root package.json for backward compatibility
  const rootContent = await fs.promises.readFile(rootPackageJsonPath, 'utf-8')
  const rootPackageJson = JSON.parse(rootContent)
  const rootScripts: ScriptInfo[] = []
  if (rootPackageJson.scripts && typeof rootPackageJson.scripts === 'object') {
    for (const [name, command] of Object.entries(rootPackageJson.scripts)) {
      if (typeof command === 'string') {
        rootScripts.push({ name, command })
      }
    }
  }

  return {
    hasPackageJson: true,
    packages,
    // Keep legacy fields for backward compatibility
    scripts: rootScripts,
    packageManager: await detectPackageManager(fsPath),
    projectName: rootPackageJson.name || PathService.basename(originalProjectPath),
  }
}

/**
 * Get package scripts from a remote SSH connection
 *
 * @param sshManager - The SSH manager instance
 * @param projectId - The project ID for the SSH connection
 * @param projectPath - The remote project path
 * @returns Package script result
 */
export async function getPackageScriptsRemote(
  sshManager: SSHManager,
  projectId: string,
  projectPath: string
): Promise<PackageScriptResult> {
  const findPackagesScript = buildRemotePackageScript(projectPath)

  console.log(`[project:get-scripts] Executing remote Node.js script...`)
  const result = await sshManager.execViaProjectMaster(projectId, findPackagesScript)
  console.log(`[project:get-scripts] Remote script output:`, result.substring(0, 200))
  const parsed = JSON.parse(result.trim())
  console.log(`[project:get-scripts] Parsed result:`, parsed)
  return parsed
}
