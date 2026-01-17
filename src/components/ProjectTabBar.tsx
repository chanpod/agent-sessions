import { Terminal, Folder, GitBranch } from 'lucide-react'
import { ProjectTab } from '../stores/project-store'
import { cn } from '../lib/utils'

interface ProjectTabBarProps {
  activeTab: ProjectTab
  onTabChange: (tab: ProjectTab) => void
  terminalCount?: number
  changedFilesCount?: number
}

export function ProjectTabBar({ activeTab, onTabChange, terminalCount = 0, changedFilesCount = 0 }: ProjectTabBarProps) {
  const tabs: { id: ProjectTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'terminals',
      label: 'Terminals',
      icon: <Terminal className="w-3.5 h-3.5" />,
      badge: terminalCount,
    },
    {
      id: 'files',
      label: 'Files',
      icon: <Folder className="w-3.5 h-3.5" />,
    },
    {
      id: 'git',
      label: 'Git',
      icon: <GitBranch className="w-3.5 h-3.5" />,
      badge: changedFilesCount,
    },
  ]

  return (
    <div className="flex items-center border-b border-gray-700/50">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative',
            activeTab === tab.id
              ? 'text-blue-400 border-b-2 border-blue-400 -mb-[1px]'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge !== undefined && tab.badge > 0 && (
            <span
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-semibold rounded-full',
                activeTab === tab.id
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-gray-700/50 text-gray-400'
              )}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
