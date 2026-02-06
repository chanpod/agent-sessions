import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// Global error handlers - log to main process
window.addEventListener('error', (event) => {
  window.electron?.log?.reportRendererError({
    message: `Uncaught error: ${event.message}`,
    stack: event.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  window.electron?.log?.reportRendererError({
    message: `Unhandled promise rejection: ${reason?.message || String(reason)}`,
    stack: reason?.stack,
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
