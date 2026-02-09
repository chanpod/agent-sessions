import React, { useState, useRef, useEffect } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { cn } from '../lib/utils'

interface TitleBarProps {
  className?: string
}

interface MenuItem {
  label?: string
  accelerator?: string
  type?: 'separator' | 'normal'
  role?: string
  action?: () => void
  submenu?: MenuItem[]
}

export const TitleBar: React.FC<TitleBarProps> = ({ className }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const menuRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && !!window.electron
  const isWindows = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win')

  useEffect(() => {
    if (!isElectron || !isWindows) return

    // Check initial maximized state
    const checkMaximized = async () => {
      const maximized = await window.electron!.window.isMaximized()
      setIsMaximized(maximized)
    }
    checkMaximized()

    // Listen for window state changes
    const unsubMaximize = window.electron!.window.onMaximize(() => {
      setIsMaximized(true)
    })
    const unsubUnmaximize = window.electron!.window.onUnmaximize(() => {
      setIsMaximized(false)
    })

    return () => {
      unsubMaximize()
      unsubUnmaximize()
    }
  }, [isElectron, isWindows])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        const clickedButton = Object.values(menuRefs.current).some(
          ref => ref && ref.contains(event.target as Node)
        )
        if (!clickedButton) {
          setActiveMenu(null)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMenuClick = (menuName: string) => {
    if (activeMenu === menuName) {
      setActiveMenu(null)
    } else {
      setActiveMenu(menuName)
    }
  }

  const handleMinimize = async () => {
    if (isElectron) {
      await window.electron!.window.minimize()
    }
  }

  const handleMaximize = async () => {
    if (isElectron) {
      await window.electron!.window.maximize()
    }
  }

  const handleClose = async () => {
    if (isElectron) {
      await window.electron!.window.close()
    }
  }

  const executeMenuAction = (action?: () => void, role?: string) => {
    setActiveMenu(null)

    if (action) {
      action()
      return
    }

    if (!isElectron || !window.electron || !role) return

    // Execute role-based actions via IPC
    if (window.electron.menu) {
      window.electron.menu.executeRole(role)
    }
  }

  // Define menu structure matching Electron's native menu
  const menus: Record<string, MenuItem[]> = {
    File: [
      {
        label: 'Close',
        role: 'close',
        accelerator: 'Alt+F4'
      }
    ],
    Edit: [
      {
        label: 'Undo',
        role: 'undo',
        accelerator: 'Ctrl+Z'
      },
      {
        label: 'Redo',
        role: 'redo',
        accelerator: 'Ctrl+Y'
      },
      { type: 'separator' },
      {
        label: 'Cut',
        role: 'cut',
        accelerator: 'Ctrl+X'
      },
      {
        label: 'Copy',
        role: 'copy',
        accelerator: 'Ctrl+C'
      },
      {
        label: 'Paste',
        role: 'paste',
        accelerator: 'Ctrl+V'
      },
      { type: 'separator' },
      {
        label: 'Select All',
        role: 'selectAll',
        accelerator: 'Ctrl+A'
      }
    ],
    View: [
      {
        label: 'Reload',
        role: 'reload',
        accelerator: 'Ctrl+R'
      },
      {
        label: 'Force Reload',
        role: 'forceReload',
        accelerator: 'Ctrl+Shift+R'
      },
      {
        label: 'Toggle Developer Tools',
        role: 'toggleDevTools',
        accelerator: 'Ctrl+Shift+I'
      },
      { type: 'separator' },
      {
        label: 'Actual Size',
        role: 'resetZoom',
        accelerator: 'Ctrl+0'
      },
      {
        label: 'Zoom In',
        role: 'zoomIn',
        accelerator: 'Ctrl+Plus'
      },
      {
        label: 'Zoom Out',
        role: 'zoomOut',
        accelerator: 'Ctrl+-'
      },
      { type: 'separator' },
      {
        label: 'Toggle Full Screen',
        role: 'togglefullscreen',
        accelerator: 'F11'
      }
    ],
    Help: [
      {
        label: 'Check for Updates...',
        action: async () => {
          if (isElectron && window.electron?.menu) {
            await window.electron.menu.checkForUpdates()
          }
        }
      }
    ]
  }

  // Only render on Windows in Electron
  if (!isElectron || !isWindows) {
    return null
  }

  return (
    <div className={cn('h-8 bg-[#1e1e1e] border-b border-gray-800 flex items-center justify-between app-drag-region', className)}>
      {/* Left: App name and menu */}
      <div className="flex items-center h-full">
        {/* App Name/Logo */}
        <div className="px-3 text-xs text-gray-400 select-none flex items-center gap-2">
          <img src="/icon.png" alt="ToolChain Logo" className="w-4 h-4" />
          ToolChain
        </div>

        {/* Menu buttons */}
        <div className="flex items-center h-full no-drag">
          {Object.keys(menus).map((menuName) => (
            <button
              key={menuName}
              ref={(el) => { menuRefs.current[menuName] = el }}
              onClick={() => handleMenuClick(menuName)}
              className={cn(
                'px-3 h-full text-xs transition-colors',
                activeMenu === menuName
                  ? 'bg-[#2a2a2b] text-gray-200'
                  : 'text-gray-400 hover:bg-[#2a2a2b] hover:text-gray-200'
              )}
            >
              {menuName}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Window controls (Windows only) */}
      <div className="flex items-center h-full no-drag">
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center hover:bg-[#2a2a2b] transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5 text-gray-400" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-12 h-full flex items-center justify-center hover:bg-[#2a2a2b] transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          <Square className="w-3 h-3 text-gray-400" />
        </button>
        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center hover:bg-red-600 transition-colors group"
          title="Close"
        >
          <X className="w-4 h-4 text-gray-400 group-hover:text-white" />
        </button>
      </div>

      {/* Menu Dropdown */}
      {activeMenu && menus[activeMenu] && (() => {
        const buttonRect = menuRefs.current[activeMenu]?.getBoundingClientRect()
        const items = menus[activeMenu]

        return (
          <div
            ref={dropdownRef}
            className="fixed py-1 bg-[#2d2d2d] border border-gray-700 rounded-sm shadow-lg z-[200] min-w-[220px] no-drag"
            style={{
              top: buttonRect ? `${buttonRect.bottom}px` : '32px',
              left: buttonRect ? `${buttonRect.left}px` : '0px',
            }}
          >
            {items.map((item, index) => {
              if (item.type === 'separator') {
                return (
                  <div key={`separator-${index}`} className="border-t border-gray-700 my-1" />
                )
              }

              return (
                <button
                  key={item.label}
                  onClick={() => executeMenuAction(item.action, item.role)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-300 hover:bg-[#3d3d3d] hover:text-white text-left"
                >
                  <span>{item.label}</span>
                  {item.accelerator && (
                    <span className="text-xs text-gray-500 ml-4">{item.accelerator}</span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}
