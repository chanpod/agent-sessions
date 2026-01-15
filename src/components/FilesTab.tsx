import { FileBrowser } from './FileBrowser'

interface FilesTabProps {
  projectPath: string
}

export function FilesTab({ projectPath }: FilesTabProps) {
  return (
    <div className="max-h-[400px] overflow-y-auto">
      <FileBrowser rootPath={projectPath} maxDepth={4} />
    </div>
  )
}
