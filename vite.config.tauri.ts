import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'
import { resolve } from 'path'

/**
 * Vite configuration for Tauri mode.
 * This strips out all Electron plugins and builds a pure web frontend
 * that communicates with the Rust backend via Tauri's invoke/listen APIs.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Tauri expects the frontend at localhost:1420
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/.claude/**', '**/*.stackdump', '**/src-tauri/**'],
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Tauri uses the dist folder
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  // Clear Electron-specific env
  define: {
    __TAURI__: true,
  },
})
