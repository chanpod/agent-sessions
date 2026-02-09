import { createContext, useContext } from 'react'
import { useBashRules, type AutoAllowMatch } from '@/hooks/useBashRules'

interface PermissionRulesContextValue {
  checkAutoAllow: (toolName: string, inputJson: string) => AutoAllowMatch | null
  revokeBashRule: (rule: string[]) => Promise<void>
  revokeToolAllow: (toolName: string) => Promise<void>
}

const PermissionRulesContext = createContext<PermissionRulesContextValue | null>(null)

export function BashRulesProvider({
  projectPath,
  children,
}: {
  projectPath: string | null | undefined
  children: React.ReactNode
}) {
  const { checkAutoAllow, revokeBashRule, revokeToolAllow } = useBashRules(projectPath)
  return (
    <PermissionRulesContext.Provider value={{ checkAutoAllow, revokeBashRule, revokeToolAllow }}>
      {children}
    </PermissionRulesContext.Provider>
  )
}

export function usePermissionRulesContext(): PermissionRulesContextValue | null {
  return useContext(PermissionRulesContext)
}
