import { EventEmitter } from 'events'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'

// ============================================================================
// Types
// ============================================================================

export type LLMStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error'

export interface LLMStatusChangeEvent {
  status: LLMStatus
  progress?: number // 0-100 for downloading
  error?: string
}

export interface LLMServiceEvents {
  'status-change': (event: LLMStatusChangeEvent) => void
}

// ============================================================================
// Constants
// ============================================================================

const MODEL_FILENAME = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'
const MODEL_URL = 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf'
const MAX_OUTPUT_CHARS = 2000

// ============================================================================
// LLM Service
// ============================================================================

export class LLMService extends EventEmitter {
  private status: LLMStatus = 'idle'
  private model: any = null
  private context: any = null
  private modelPath: string = ''
  private llama: any = null

  constructor() {
    super()
    const modelsDir = path.join(app.getPath('userData'), 'models')
    this.modelPath = path.join(modelsDir, MODEL_FILENAME)
  }

  /**
   * Get current status
   */
  getStatus(): LLMStatus {
    return this.status
  }

  /**
   * Emit status change event
   */
  private setStatus(status: LLMStatus, progress?: number, error?: string): void {
    this.status = status
    const event: LLMStatusChangeEvent = { status }
    if (progress !== undefined) event.progress = progress
    if (error !== undefined) event.error = error
    this.emit('status-change', event)
  }

  /**
   * Check if model file exists
   */
  private async modelExists(): Promise<boolean> {
    try {
      await fs.access(this.modelPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Download model from HuggingFace
   */
  private async downloadModel(): Promise<void> {
    this.setStatus('downloading', 0)

    const modelsDir = path.dirname(this.modelPath)
    await fs.mkdir(modelsDir, { recursive: true })

    const tempPath = this.modelPath + '.tmp'

    try {
      const response = await fetch(MODEL_URL)

      if (!response.ok) {
        throw new Error(`Failed to download model: ${response.status} ${response.statusText}`)
      }

      const contentLength = response.headers.get('content-length')
      const totalSize = contentLength ? parseInt(contentLength, 10) : 0

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let downloadedSize = 0

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        chunks.push(value)
        downloadedSize += value.length

        if (totalSize > 0) {
          const progress = Math.round((downloadedSize / totalSize) * 100)
          this.setStatus('downloading', progress)
        }
      }

      // Combine chunks and write to file
      const allChunks = new Uint8Array(downloadedSize)
      let offset = 0
      for (const chunk of chunks) {
        allChunks.set(chunk, offset)
        offset += chunk.length
      }

      await fs.writeFile(tempPath, allChunks)

      // Rename temp file to final path
      await fs.rename(tempPath, this.modelPath)

      console.log('[LLMService] Model downloaded successfully')
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath)
      } catch {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  /**
   * Initialize the LLM service
   * Downloads model if needed and loads it into memory
   */
  async initialize(): Promise<void> {
    if (this.status === 'ready') {
      return
    }

    if (this.status === 'loading' || this.status === 'downloading') {
      throw new Error('LLM service is already initializing')
    }

    try {
      // Check if model exists, download if not
      if (!(await this.modelExists())) {
        await this.downloadModel()
      }

      this.setStatus('loading')

      // Dynamically import node-llama-cpp
      const { getLlama, LlamaChatSession } = await import('node-llama-cpp')

      // Initialize llama with CPU (default)
      this.llama = await getLlama()

      // Load the model
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
      })

      // Create context with small context size for efficiency
      this.context = await this.model.createContext({
        contextSize: 2048,
      })

      this.setStatus('ready')
      console.log('[LLMService] Model loaded and ready')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[LLMService] Initialization failed:', errorMessage)
      this.setStatus('error', undefined, errorMessage)
      throw error
    }
  }

  /**
   * Generate a short terminal name based on command output
   * @param output - The terminal output to analyze
   * @returns A 2-4 word terminal name, or null on failure
   */
  async generateTerminalName(output: string): Promise<string | null> {
    if (this.status !== 'ready') {
      console.warn('[LLMService] Cannot generate name: service not ready')
      return null
    }

    try {
      const { LlamaChatSession } = await import('node-llama-cpp')

      // Truncate output to keep context small
      const truncatedOutput = output.slice(0, MAX_OUTPUT_CHARS)

      // Create a new chat session for this request
      const session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
      })

      const systemPrompt = `You are a terminal naming assistant. Given terminal output, respond with ONLY a short 2-4 word descriptive name for this terminal session. No explanations, no quotes, just the name.`

      const userPrompt = `Terminal output:\n${truncatedOutput}\n\nGenerate a 2-4 word name for this terminal:`

      const response = await session.prompt(userPrompt, {
        systemPrompt,
        maxTokens: 20,
      })

      // Clean up the response - extract just the name
      const name = response
        .trim()
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes
        .replace(/\n.*/g, '') // Take only first line
        .trim()

      // Validate the name is reasonable (2-4 words, not too long)
      const words = name.split(/\s+/)
      if (words.length >= 1 && words.length <= 5 && name.length <= 50) {
        return name
      }

      // If response is too long or weird, try to take first few words
      if (words.length > 5) {
        return words.slice(0, 4).join(' ')
      }

      console.warn('[LLMService] Generated name was invalid:', name)
      return null
    } catch (error) {
      console.error('[LLMService] Error generating terminal name:', error)
      return null
    }
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    try {
      if (this.context) {
        await this.context.dispose()
        this.context = null
      }

      if (this.model) {
        await this.model.dispose()
        this.model = null
      }

      if (this.llama) {
        await this.llama.dispose()
        this.llama = null
      }

      this.setStatus('idle')
      console.log('[LLMService] Disposed successfully')
    } catch (error) {
      console.error('[LLMService] Error during dispose:', error)
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let llmServiceInstance: LLMService | null = null

/**
 * Get the singleton LLM service instance
 */
export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService()
  }
  return llmServiceInstance
}

/**
 * Dispose the singleton instance
 */
export async function disposeLLMService(): Promise<void> {
  if (llmServiceInstance) {
    await llmServiceInstance.dispose()
    llmServiceInstance = null
  }
}
