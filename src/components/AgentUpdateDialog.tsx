import React, { useState } from 'react';
import { X, Sparkles, Gem, Code, Bot, Loader2, CheckCircle, XCircle, RefreshCw, Download, Terminal } from 'lucide-react';
import type { CliToolDetectionResult, UpdateCheckResult } from '../types/electron';

interface AgentUpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agent: CliToolDetectionResult;
  updateInfo: UpdateCheckResult | null;
  isCheckingUpdate: boolean;
  onRefresh: () => Promise<void>;
  onInstall: (method: 'npm' | 'native' | 'brew') => Promise<{ success: boolean; output: string }>;
  onInstallComplete: () => void;
}

type DialogStep = 'info' | 'installing' | 'result';

const AGENT_ICONS: Record<string, React.ReactNode> = {
  claude: <Sparkles className="w-6 h-6 text-amber-400" />,
  gemini: <Gem className="w-6 h-6 text-blue-400" />,
  codex: <Code className="w-6 h-6 text-green-400" />,
};

function getAgentIcon(id: string): React.ReactNode {
  return AGENT_ICONS[id] || <Bot className="w-6 h-6 text-zinc-400" />;
}

export const AgentUpdateDialog: React.FC<AgentUpdateDialogProps> = ({
  isOpen,
  onClose,
  agent,
  updateInfo,
  isCheckingUpdate,
  onRefresh,
  onInstall,
  onInstallComplete,
}) => {
  const [step, setStep] = useState<DialogStep>('info');
  const [installOutput, setInstallOutput] = useState('');
  const [installSuccess, setInstallSuccess] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resetState = () => {
    setStep('info');
    setInstallOutput('');
    setInstallSuccess(null);
    setIsRefreshing(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleInstall = async () => {
    setStep('installing');
    setInstallOutput('Starting installation...\n');

    try {
      // Use the detected install method, defaulting to 'npm' if unknown
      const method = agent.installMethod === 'unknown' || !agent.installMethod ? 'npm' : agent.installMethod;
      const result = await onInstall(method);
      setInstallOutput(result.output);
      setInstallSuccess(result.success);
      setStep('result');
    } catch (error) {
      setInstallOutput(`Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setInstallSuccess(false);
      setStep('result');
    }
  };

  const handleDone = () => {
    if (installSuccess) {
      onInstallComplete();
    }
    handleClose();
  };

  if (!isOpen) return null;

  const hasUpdate = updateInfo?.updateAvailable && updateInfo.latestVersion;
  const currentVersion = agent.version || updateInfo?.currentVersion;
  const latestVersion = updateInfo?.latestVersion;
  const isLoading = isCheckingUpdate || isRefreshing;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-200">
            {step === 'info' && agent.name}
            {step === 'installing' && `Installing Update...`}
            {step === 'result' && (installSuccess ? 'Update Complete' : 'Update Failed')}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Info Step */}
          {step === 'info' && (
            <div className="space-y-4">
              {/* Agent Info */}
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0">
                  {getAgentIcon(agent.id)}
                </div>
                <div className="flex-1">
                  <div className="text-zinc-200 font-medium">{agent.name}</div>
                  <div className="text-sm text-zinc-500">
                    {agent.path || 'CLI Agent'}
                  </div>
                </div>
              </div>

              {/* Version Info */}
              <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Current Version</span>
                  <span className="text-sm font-mono text-zinc-200">
                    {currentVersion ? `v${currentVersion}` : 'Unknown'}
                  </span>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    <span className="ml-2 text-sm text-zinc-400">Checking for updates...</span>
                  </div>
                ) : (
                  <>
                    {hasUpdate && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-400">Latest Version</span>
                        <span className="text-sm font-mono text-green-400">
                          v{latestVersion}
                        </span>
                      </div>
                    )}

                    {/* Update Status */}
                    <div className="pt-2 border-t border-zinc-700">
                      {hasUpdate ? (
                        <div className="flex items-center gap-2 text-amber-400">
                          <Download className="w-4 h-4" />
                          <span className="text-sm font-medium">Update available</span>
                        </div>
                      ) : updateInfo?.error ? (
                        <div className="flex items-center gap-2 text-red-400">
                          <XCircle className="w-4 h-4" />
                          <span className="text-sm">{updateInfo.error}</span>
                        </div>
                      ) : updateInfo ? (
                        <div className="flex items-center gap-2 text-green-400">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">You are up to date</span>
                        </div>
                      ) : !currentVersion ? (
                        <div className="flex items-center gap-2 text-zinc-500">
                          <span className="text-sm">Version unknown - cannot check for updates</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-zinc-500">
                          <span className="text-sm">Click refresh to check for updates</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Installing Step */}
          {step === 'installing' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3 py-4">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                <span className="text-zinc-200">Installing update for {agent.name}...</span>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Terminal className="w-4 h-4" />
                  <span className="text-xs">Installation Output</span>
                </div>
                <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {installOutput || 'Waiting for output...'}
                </pre>
              </div>
            </div>
          )}

          {/* Result Step */}
          {step === 'result' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3 py-4">
                {installSuccess ? (
                  <>
                    <CheckCircle className="w-8 h-8 text-green-400" />
                    <div className="text-center">
                      <div className="text-zinc-200 font-medium">
                        {agent.name} updated successfully!
                      </div>
                      <div className="text-sm text-zinc-400">
                        The latest version has been installed.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="w-8 h-8 text-red-400" />
                    <div className="text-center">
                      <div className="text-zinc-200 font-medium">Update failed</div>
                      <div className="text-sm text-zinc-400">
                        Please check the output below for details.
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Terminal className="w-4 h-4" />
                  <span className="text-xs">Installation Output</span>
                </div>
                <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {installOutput}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-zinc-800">
          {step === 'info' && (
            <>
              <button
                onClick={handleRefresh}
                disabled={isLoading || !currentVersion}
                className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleInstall}
                disabled={!hasUpdate || isLoading}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md transition-colors"
              >
                Install Update
              </button>
            </>
          )}

          {step === 'installing' && (
            <button
              disabled
              className="px-4 py-2 text-sm bg-zinc-700 text-zinc-500 rounded-md cursor-not-allowed"
            >
              Installing...
            </button>
          )}

          {step === 'result' && (
            <>
              {!installSuccess && (
                <button
                  onClick={() => setStep('info')}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleDone}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
              >
                {installSuccess ? 'Done' : 'Close'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentUpdateDialog;
