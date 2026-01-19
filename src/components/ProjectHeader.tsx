import React, { useState } from 'react'
import { Plus, X, FolderGit2 } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { cn } from '../lib/utils'

interface ProjectHeaderProps {
  onCreateProject: () => void
  onEditProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
}

export const ProjectHeader: React.FC<ProjectHeaderProps> = ({
  onCreateProject,
}) => {
  const { projects, activeProjectId, setActiveProject } = useProjectStore()
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)

  return (
    <div className="h-10 bg-[#1e1e1e] border-b border-gray-800 flex items-stretch app-drag-region">
      {/* Project Tabs */}
      <div className="flex items-stretch overflow-x-auto no-drag">
        {projects.map((project, index) => (
          <div
            key={project.id}
            className={cn(
              'relative flex items-center gap-2 px-4 min-w-[120px] max-w-[200px] border-r border-gray-800 cursor-pointer transition-colors group',
              activeProjectId === project.id
                ? 'bg-[#252526] text-gray-200'
                : 'bg-[#1e1e1e] text-gray-400 hover:bg-[#2a2a2b]'
            )}
            onClick={() => setActiveProject(project.id)}
            onMouseEnter={() => setHoveredProjectId(project.id)}
            onMouseLeave={() => setHoveredProjectId(null)}
          >
            <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs truncate flex-1">{project.name}</span>

            {/* Close button - shows on hover */}
            {hoveredProjectId === project.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  // TODO: Show confirmation dialog before deleting
                  // For now, just prevent accidental clicks
                }}
                className="p-0.5 hover:bg-gray-700 rounded opacity-70 hover:opacity-100"
                title="Close project"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {/* Add Project Tab */}
        <button
          onClick={onCreateProject}
          className="flex items-center justify-center px-3 border-r border-gray-800 hover:bg-[#2a2a2b] transition-colors no-drag"
          title="Add project"
        >
          <Plus className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1" />
    </div>
  )
}
