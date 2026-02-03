import initSqlJs, { Database } from 'sql.js'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'

/**
 * SQLite-based key-value store for ToolChain
 * Uses sql.js (SQLite compiled to WASM) - no native compilation needed
 */
export class ToolChainDB {
  private db: Database | null = null
  private dbPath: string
  private initialized = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'toolchain.db')
    console.log('[Database] Will initialize SQLite at:', this.dbPath)
  }

  /**
   * Initialize the database (must be called before use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[Database] Initializing sql.js...')

    try {
      // Initialize sql.js with explicit WASM file path
      // In development: load from node_modules
      // In production: load from app resources
      const isDev = !app.isPackaged
      const SQL = await initSqlJs({
        locateFile: (file) => {
          if (isDev) {
            // Development: use node_modules path
            const wasmPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
            console.log('[Database] Loading WASM from (dev):', wasmPath)
            return wasmPath
          } else {
            // Production: use app resources path
            const wasmPath = path.join(process.resourcesPath, 'sql-wasm.wasm')
            console.log('[Database] Loading WASM from (prod):', wasmPath)
            return wasmPath
          }
        },
      })

      // Load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath)
        this.db = new SQL.Database(buffer)
        console.log('[Database] Loaded existing database')
      } else {
        this.db = new SQL.Database()
        console.log('[Database] Created new database')
      }

      // Initialize schema
      this.initializeSchema()

      this.initialized = true
      console.log('[Database] Initialized successfully')
    } catch (err) {
      console.error('[Database] Failed to initialize:', err)
      throw err
    }
  }

  private initializeSchema() {
    if (!this.db) throw new Error('Database not initialized')

    // Simple key-value table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Create index on updated_at for potential future queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_kv_updated
      ON kv_store(updated_at)
    `)

    // CLI detection cache table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cli_detection_cache (
        cache_key TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        execution_context TEXT NOT NULL,
        result_json TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      )
    `)

    // Create index on project_path for clearing cache by project
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_cli_cache_project
      ON cli_detection_cache(project_path)
    `)

    this.save()
  }

  /**
   * Save database to disk
   */
  private save(): void {
    if (!this.db) return

    const data = this.db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(this.dbPath, buffer)
  }

  /**
   * Get value by key
   */
  get(key: string): unknown {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT value FROM kv_store WHERE key = ?')
    stmt.bind([key])

    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()

      try {
        return JSON.parse(row.value as string)
      } catch (err) {
        console.error(`[Database] Failed to parse value for key "${key}":`, err)
        return undefined
      }
    }

    stmt.free()
    return undefined
  }

  /**
   * Set value for key
   */
  set(key: string, value: unknown): void {
    if (!this.db) throw new Error('Database not initialized')

    const valueStr = JSON.stringify(value)
    const now = Date.now()

    this.db.run(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [key, valueStr, now]
    )

    this.save()
  }

  /**
   * Delete key
   */
  delete(key: string): void {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM kv_store WHERE key = ?', [key])
    this.save()
  }

  /**
   * Clear all data
   */
  clear(): void {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM kv_store')
    this.save()
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT key FROM kv_store')
    const keys: string[] = []

    while (stmt.step()) {
      const row = stmt.getAsObject()
      keys.push(row.key as string)
    }

    stmt.free()
    return keys
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ? LIMIT 1')
    stmt.bind([key])
    const exists = stmt.step()
    stmt.free()
    return exists
  }

  /**
   * Get database path
   */
  get path(): string {
    return this.dbPath
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }

  // ============================================================================
  // CLI Detection Cache Methods
  // ============================================================================

  /**
   * Result structure for cached CLI detection
   */
  getCachedCliDetection(cacheKey: string): CachedCliDetectionResult | null {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const stmt = this.db.prepare(
        'SELECT project_path, execution_context, result_json, detected_at FROM cli_detection_cache WHERE cache_key = ?'
      )
      stmt.bind([cacheKey])

      if (stmt.step()) {
        const row = stmt.getAsObject() as {
          project_path: string
          execution_context: string
          result_json: string
          detected_at: number
        }
        stmt.free()

        try {
          const result = JSON.parse(row.result_json)
          return {
            projectPath: row.project_path,
            executionContext: row.execution_context,
            result,
            detectedAt: row.detected_at,
          }
        } catch (parseErr) {
          console.error(`[Database] Failed to parse CLI detection cache for key "${cacheKey}":`, parseErr)
          return null
        }
      }

      stmt.free()
      return null
    } catch (err) {
      console.error(`[Database] Error reading CLI detection cache for key "${cacheKey}":`, err)
      return null
    }
  }

  /**
   * Store CLI detection result in cache
   */
  setCachedCliDetection(
    cacheKey: string,
    projectPath: string,
    executionContext: string,
    result: unknown
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const resultJson = JSON.stringify(result)
      const now = Date.now()

      this.db.run(
        `INSERT INTO cli_detection_cache (cache_key, project_path, execution_context, result_json, detected_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           project_path = excluded.project_path,
           execution_context = excluded.execution_context,
           result_json = excluded.result_json,
           detected_at = excluded.detected_at`,
        [cacheKey, projectPath, executionContext, resultJson, now]
      )

      this.save()
      console.log(`[Database] Cached CLI detection for key "${cacheKey}"`)
    } catch (err) {
      console.error(`[Database] Error storing CLI detection cache for key "${cacheKey}":`, err)
    }
  }

  /**
   * Clear CLI detection cache
   * @param projectPath - If provided, only clear cache for this project; otherwise clear all
   */
  clearCliDetectionCache(projectPath?: string): void {
    if (!this.db) throw new Error('Database not initialized')

    try {
      if (projectPath) {
        this.db.run('DELETE FROM cli_detection_cache WHERE project_path = ?', [projectPath])
        console.log(`[Database] Cleared CLI detection cache for project: ${projectPath}`)
      } else {
        this.db.run('DELETE FROM cli_detection_cache')
        console.log('[Database] Cleared all CLI detection cache')
      }
      this.save()
    } catch (err) {
      console.error('[Database] Error clearing CLI detection cache:', err)
    }
  }

  /**
   * Get all cached CLI detection keys (for debugging)
   */
  getCliDetectionCacheKeys(): string[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT cache_key FROM cli_detection_cache')
    const keys: string[] = []

    while (stmt.step()) {
      const row = stmt.getAsObject()
      keys.push(row.cache_key as string)
    }

    stmt.free()
    return keys
  }
}

/**
 * Cached CLI detection result structure
 */
export interface CachedCliDetectionResult {
  projectPath: string
  executionContext: string
  result: unknown
  detectedAt: number
}
