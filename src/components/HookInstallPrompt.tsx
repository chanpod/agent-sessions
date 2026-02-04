import { IconShieldCheck, IconAlertTriangle, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

interface HookInstallPromptProps {
  projectName: string
  onInstall: () => void
  onSkip: () => void
  onCancel: () => void
}

export function HookInstallPrompt({ projectName, onInstall, onSkip, onCancel }: HookInstallPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <IconShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Permission Hook Setup</h2>
            <p className="text-xs text-muted-foreground">
              Configure tool approval for <span className="font-medium text-foreground">{projectName}</span>
            </p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-zinc-800">
            <IconX className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-zinc-300">
            Install a permission hook so you can approve or deny each tool use from within this app?
          </p>

          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-start gap-2">
              <IconShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <div className="text-xs text-zinc-300">
                <p className="font-medium text-emerald-400">With hook installed</p>
                <p className="mt-1">Each tool use triggers an approval dialog. You stay in control.</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div className="text-xs text-zinc-300">
                <p className="font-medium text-amber-400">Without hook (skip permissions)</p>
                <p className="mt-1">Agent runs with full permissions. No approval required.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={onSkip}>
            <IconAlertTriangle className="size-4" />
            Skip Permissions
          </Button>
          <Button variant="default" size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={onInstall}>
            <IconShieldCheck className="size-4" />
            Install Hook
          </Button>
        </div>
      </div>
    </div>
  )
}
