import { describe, it, expect, vi } from 'vitest'

describe('Vitest Setup', () => {
  it('should have TypeScript compilation working', () => {
    const testValue: string = 'hello'
    expect(testValue).toBe('hello')
  })

  it('should have Electron mocks available', async () => {
    const { app, BrowserWindow, ipcMain } = await import('electron')

    expect(app).toBeDefined()
    expect(app.getPath).toBeDefined()
    expect(app.whenReady).toBeDefined()

    expect(BrowserWindow).toBeDefined()
    expect(ipcMain).toBeDefined()
    expect(ipcMain.handle).toBeDefined()
  })

  it('should have node-pty mocks available', async () => {
    const pty = await import('node-pty')

    expect(pty.spawn).toBeDefined()
    expect(typeof pty.spawn).toBe('function')
  })

  it('should have sql.js mocks available', async () => {
    const initSqlJs = (await import('sql.js')).default

    expect(initSqlJs).toBeDefined()
    expect(typeof initSqlJs).toBe('function')
  })

  it('should be able to use vi mocking utilities', () => {
    const mockFn = vi.fn()
    mockFn('test')

    expect(mockFn).toHaveBeenCalledWith('test')
    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('should have NODE_ENV set to test', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })
})

describe('Basic Electron API Tests', () => {
  it('should mock app.getPath correctly', async () => {
    const { app } = await import('electron')

    const userDataPath = app.getPath('userData')
    expect(userDataPath).toBe('/mock/userData')

    const appDataPath = app.getPath('appData')
    expect(appDataPath).toBe('/mock/appData')
  })

  it('should mock BrowserWindow creation', async () => {
    const { BrowserWindow } = await import('electron')

    const win = new BrowserWindow({ width: 800, height: 600 })

    expect(win).toBeDefined()
    expect(win.loadURL).toBeDefined()
    expect(win.webContents).toBeDefined()
    expect(win.webContents.send).toBeDefined()
  })

  it('should mock ipcMain.handle', async () => {
    const { ipcMain } = await import('electron')

    const handler = vi.fn()
    ipcMain.handle('test-channel', handler)

    expect(ipcMain.handle).toHaveBeenCalledWith('test-channel', handler)
  })
})
