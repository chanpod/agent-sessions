import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Use Node.js environment for Electron main process testing
    environment: 'node',

    // Include test files
    include: ['electron/**/*.test.ts', 'electron/**/*.spec.ts'],

    // Exclude build directories
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/build/**',
      '**/release/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*'
    ],

    // Setup file
    setupFiles: ['./electron/test/setup.ts'],

    // Enable globals for easier testing
    globals: true,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'dist-electron/',
        'build/',
        'release/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test/**',
      ],
    },
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
