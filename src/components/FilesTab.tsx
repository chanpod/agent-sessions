import { FileBrowser } from './FileBrowser'

interface FilesTabProps {
  projectId: string
  projectPath: string
}

export function FilesTab({ projectId, projectPath }: FilesTabProps) {
  return (
    <div className="max-h-[400px] overflow-y-auto">
      <FileBrowser projectId={projectId} rootPath={projectPath} maxDepth={4} />
    </div>
  )
}
