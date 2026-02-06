import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface SectionProps {
  children: ReactNode;
  name?: string;
  className?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to main process for persistent file logging
    window.electron?.log?.reportRendererError({
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-zinc-900 text-zinc-100 p-8">
          <div className="max-w-lg text-center space-y-6">
            <h1 className="text-2xl font-bold text-red-400">Something went wrong</h1>
            <p className="text-zinc-400">
              The application encountered an unexpected error. The error has been logged.
            </p>
            {this.state.error && (
              <pre className="text-left text-sm bg-zinc-800 border border-zinc-700 rounded-lg p-4 overflow-auto max-h-48 text-red-300">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
              >
                Reload App
              </button>
              <button
                onClick={() => window.electron?.log?.openLogsFolder()}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-md transition-colors"
              >
                Open Log File
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Lightweight error boundary for individual sections/panels.
 * Shows an inline error message with retry instead of bricking the whole app.
 */
export class SectionErrorBoundary extends Component<SectionProps, State> {
  constructor(props: SectionProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    window.electron?.log?.reportRendererError({
      message: `[${this.props.name || 'Section'}] ${error.message}`,
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={`flex flex-col items-center justify-center gap-3 p-4 text-zinc-400 ${this.props.className || ''}`}>
          <p className="text-sm text-red-400">
            {this.props.name ? `${this.props.name} crashed` : 'This section crashed'}
          </p>
          {this.state.error && (
            <pre className="text-xs text-red-300/70 bg-zinc-800/50 rounded px-3 py-2 max-w-md overflow-auto max-h-24">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
