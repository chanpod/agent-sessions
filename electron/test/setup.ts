import { vi } from 'vitest'

// Mock the 'electron' module
vi.mock('electron', () => {
  // Create a proper constructor function
  function MockBrowserWindow() {
    return {
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      once: vi.fn(),
      webContents: {
        send: vi.fn(),
        on: vi.fn(),
        openDevTools: vi.fn(),
      },
      isDestroyed: vi.fn().mockReturnValue(false),
      close: vi.fn(),
      destroy: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      maximize: vi.fn(),
      minimize: vi.fn(),
      setMenuBarVisibility: vi.fn(),
    }
  }

  const mockBrowserWindow = vi.fn(MockBrowserWindow)

  return {
    app: {
      quit: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      whenReady: vi.fn().mockResolvedValue(undefined),
      getPath: vi.fn((name: string) => {
        const paths: Record<string, string> = {
          userData: '/mock/userData',
          appData: '/mock/appData',
          temp: '/mock/temp',
          home: '/mock/home',
          exe: '/mock/exe',
        }
        return paths[name] || `/mock/${name}`
      }),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
      getName: vi.fn().mockReturnValue('test-app'),
      isReady: vi.fn().mockReturnValue(true),
      requestSingleInstanceLock: vi.fn().mockReturnValue(true),
      setAppUserModelId: vi.fn(),
    },
    BrowserWindow: mockBrowserWindow,
    ipcMain: {
      on: vi.fn(),
      once: vi.fn(),
      handle: vi.fn(),
      removeHandler: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    Menu: {
      setApplicationMenu: vi.fn(),
      buildFromTemplate: vi.fn(),
    },
    Tray: vi.fn().mockImplementation(() => ({
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    })),
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
      showErrorBox: vi.fn(),
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(''),
      showItemInFolder: vi.fn(),
    },
    nativeTheme: {
      themeSource: 'system',
      shouldUseDarkColors: false,
      on: vi.fn(),
    },
  }
})

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn().mockImplementation(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
}))

// Mock sql.js
vi.mock('sql.js', () => ({
  default: vi.fn().mockResolvedValue({
    Database: vi.fn().mockImplementation(() => ({
      run: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn(),
      close: vi.fn(),
    })),
  }),
}))

// Set up global test environment
global.process.env.NODE_ENV = 'test'
