import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TerminalArea } from './components/TerminalArea'
import { useTerminalStore } from './stores/terminal-store'

function App() {
  const [isElectron, setIsElectron] = useState(false)
  const { addSession, removeSession, updateSessionTitle, markSessionExited } = useTerminalStore()

  useEffect(() => {
    // Check if running in Electron
    setIsElectron(typeof window !== 'undefined' && !!window.electron)
  }, [])

  useEffect(() => {
    if (!isElectron || !window.electron) return

    // Set up PTY event listeners
    const unsubData = window.electron.pty.onData(() => {
      // Data is handled by individual Terminal components
    })

    const unsubExit = window.electron.pty.onExit((id, code) => {
      markSessionExited(id, code)
    })

    const unsubTitle = window.electron.pty.onTitleChange((id, title) => {
      updateSessionTitle(id, title)
    })

    return () => {
      unsubData()
      unsubExit()
      unsubTitle()
    }
  }, [isElectron, markSessionExited, updateSessionTitle])

  const handleCreateTerminal = async (shell: { name: string; path: string }) => {
    if (!window.electron) return

    const info = await window.electron.pty.create({ shell: shell.path })
    addSession({
      id: info.id,
      pid: info.pid,
      shell: info.shell,
      cwd: info.cwd,
      title: shell.name, // Use friendly name instead of path
      createdAt: info.createdAt,
    })
  }

  const handleCloseTerminal = async (id: string) => {
    if (!window.electron) return

    await window.electron.pty.kill(id)
    removeSession(id)
  }

  if (!isElectron) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Agent Sessions</h1>
          <p className="text-muted-foreground">
            This app requires Electron to run.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Run <code className="bg-muted px-2 py-1 rounded">npm run electron:dev</code> to start.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        onCreateTerminal={handleCreateTerminal}
        onCloseTerminal={handleCloseTerminal}
      />
      <TerminalArea />
    </div>
  )
}

export default App
