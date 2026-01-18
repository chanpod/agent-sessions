import { useEffect, useState } from 'react'

export function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!window.electron) return

    // Listen for update downloaded event
    const cleanup = window.electron.updater.onUpdateDownloaded((info) => {
      console.log('Update downloaded:', info)
      setUpdateInfo(info)
      setIsVisible(true)
    })

    return cleanup
  }, [])

  const handleUpdate = async () => {
    if (!window.electron) return
    await window.electron.updater.install()
  }

  const handleDismiss = async () => {
    if (!window.electron || !updateInfo) return

    // Dismiss the update in the database so we don't show it again for 24 hours
    await window.electron.updater.dismiss(updateInfo.version)

    setIsVisible(false)
  }

  if (!isVisible || !updateInfo) return null

  return (
    <div className="fixed bottom-4 right-4 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg p-4 min-w-[320px] max-w-md z-50 animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-100">
              Update Available
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Version {updateInfo.version} is ready to install
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Dismiss"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleUpdate}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors"
          >
            Update Now
          </button>
          <button
            onClick={handleDismiss}
            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium py-2 px-4 rounded transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
