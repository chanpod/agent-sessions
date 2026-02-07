import React, { useState } from 'react';
import { X, Sparkles, Gem, Code, Bot, Loader2, CheckCircle, XCircle, RefreshCw, Download, Terminal, AlertTriangle, Package, Globe } from 'lucide-react';
import type { CliToolDetectionResult, UpdateCheckResult } from '../types/electron';

interface AgentUpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agent: CliToolDetectionResult;
  updateInfo: UpdateCheckResult | null;
  isCheckingUpdate: boolean;
  platform: 'windows' | 'macos' | 'linux';
  onRefresh: () => Promise<void>;
  onInstall: (method: 'npm' | 'native' | 'brew') => Promise<{ success: boolean; output: string }>;
  onInstallComplete: () => void;
}

type DialogStep = 'info' | 'select-method' | 'installing' | 'result';

const AGENT_ICONS: Record<string, React.ReactNode> = {
  claude: <Sparkles className="w-6 h-6 text-amber-400" />,
  gemini: <Gem className="w-6 h-6 text-blue-400" />,
  codex: <Code className="w-6 h-6 text-green-400" />,
};

function getAgentIcon(id: string): React.ReactNode {
  return AGENT_ICONS[id] || <Bot className="w-6 h-6 text-zinc-400" />;
}

/** Display label for an install method */
function getMethodLabel(method: 'npm' | 'native' | 'brew' | 'unknown'): string {
  switch (method) {
    case 'native': return 'Native Installer';
    case 'npm': return 'npm';
    case 'brew': return 'Homebrew';
    case 'unknown': return 'Unknown';
  }
}

/** Badge color for install methods */
function getMethodBadgeClass(method: 'npm' | 'native' | 'brew' | 'unknown'): string {
  switch (method) {
    case 'native': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'npm': return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'brew': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'unknown': return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  }
}

/** Get available update methods for an agent */
function getUpdateMethods(
  agentId: string,
  currentMethod: 'npm' | 'native' | 'brew' | 'unknown',
  platform: 'windows' | 'macos' | 'linux'
): Array<{ id: 'npm' | 'native' | 'brew'; label: string; command: string; recommended: boolean; warning?: string }> {
  const methods: Array<{ id: 'npm' | 'native' | 'brew'; label: string; command: string; recommended: boolean; warning?: string }> = [];

  if (agentId === 'claude') {
    // Native is always recommended for Claude
    const nativeCmd = platform === 'windows'
      ? 'irm https://claude.ai/install.ps1 | iex'
      : 'curl -fsSL https://claude.ai/install.sh | bash';
    methods.push({
      id: 'native',
      label: platform === 'windows' ? 'PowerShell Installer' : 'Native Installer',
      command: nativeCmd,
      recommended: true,
    });
    methods.push({
      id: 'npm',
      label: 'npm',
      command: 'npm i -g @anthropic-ai/claude-code',
      recommended: false,
      warning: currentMethod === 'native' ? 'You installed via native - using npm may cause conflicts' : undefined,
    });
  } else if (agentId === 'codex') {
    methods.push({
      id: 'npm',
      label: 'npm',
      command: 'npm i -g @openai/codex',
      recommended: true,
    });
    if (platform === 'macos') {
      methods.push({
        id: 'brew',
        label: 'Homebrew Cask',
        command: 'brew install --cask codex',
        recommended: false,
      });
    }
  } else if (agentId === 'gemini') {
    methods.push({
      id: 'npm',
      label: 'npm',
      command: 'npm i -g @google/gemini-cli',
      recommended: true,
    });
    if (platform === 'macos') {
      methods.push({
        id: 'brew',
        label: 'Homebrew',
        command: 'brew install gemini-cli',
        recommended: false,
      });
    }
  }

  return methods;
}

export const AgentUpdateDialog: React.FC<AgentUpdateDialogProps> = ({
  isOpen,
  onClose,
  agent,
  updateInfo,
  isCheckingUpdate,
  platform,
  onRefresh,
  onInstall,
  onInstallComplete,
}) => {
  const [step, setStep] = useState<DialogStep>('info');
  const [installOutput, setInstallOutput] = useState('');
  const [installSuccess, setInstallSuccess] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'npm' | 'native' | 'brew' | null>(null);

  const resetState = () => {
    setStep('info');
    setInstallOutput('');
    setInstallSuccess(null);
    setIsRefreshing(false);
    setSelectedMethod(null);
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

  const handleUpdateClick = () => {
    const methods = getUpdateMethods(agent.id, agent.installMethod || 'unknown', platform);
    if (methods.length === 1 && methods[0]) {
      // Only one method available, go straight to install
      doInstall(methods[0].id);
    } else {
      setStep('select-method');
    }
  };

  const doInstall = async (method: 'npm' | 'native' | 'brew') => {
    setSelectedMethod(method);
    setStep('installing');
    setInstallOutput('Starting update...\n');

    try {
      const result = await onInstall(method);
      setInstallOutput(result.output);
      setInstallSuccess(result.success);
      setStep('result');
    } catch (error) {
      setInstallOutput(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  const installMethod = agent.installMethod || 'unknown';
  const updateMethods = getUpdateMethods(agent.id, installMethod, platform);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-200">
            {step === 'info' && agent.name}
            {step === 'select-method' && 'Choose Update Method'}
            {step === 'installing' && 'Updating...'}
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
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 font-medium">{agent.name}</div>
                  <div className="text-xs text-zinc-500 truncate" title={agent.path}>
                    {agent.path || 'CLI Agent'}
                  </div>
                </div>
                {/* Install method badge */}
                <span className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded border ${getMethodBadgeClass(installMethod)}`}>
                  {installMethod === 'native' ? (
                    <Globe className="w-3 h-3" />
                  ) : (
                    <Package className="w-3 h-3" />
                  )}
                  {getMethodLabel(installMethod)}
                </span>
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
                          <span className="text-sm">Up to date</span>
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

              {/* Warning for npm-installed Claude */}
              {agent.id === 'claude' && installMethod === 'npm' && (
                <div className="flex gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300/80">
                    <span className="font-medium">Native installer is recommended for Claude.</span>{' '}
                    npm installs may not auto-update correctly. Consider switching to the native installer.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Select Method Step */}
          {step === 'select-method' && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                Choose how to update {agent.name}:
              </p>

              {updateMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => doInstall(method.id)}
                  className="w-full text-left px-4 py-3 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-200">
                      {method.label}
                    </span>
                    {method.recommended && (
                      <span className="text-xs text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-zinc-500 bg-zinc-900/50 px-2 py-1 rounded">
                    {method.command}
                  </div>
                  {method.warning && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-400/80">
                      <AlertTriangle className="w-3 h-3" />
                      {method.warning}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Installing Step */}
          {step === 'installing' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3 py-4">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                <span className="text-zinc-200">
                  Updating {agent.name}
                  {selectedMethod ? ` via ${getMethodLabel(selectedMethod)}` : ''}...
                </span>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Terminal className="w-4 h-4" />
                  <span className="text-xs">Output</span>
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
                        Check the output below for details.
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Terminal className="w-4 h-4" />
                  <span className="text-xs">Output</span>
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
                onClick={handleUpdateClick}
                disabled={!hasUpdate || isLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md transition-colors"
              >
                <Download className="w-4 h-4" />
                Update
              </button>
            </>
          )}

          {step === 'select-method' && (
            <button
              onClick={() => setStep('info')}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Back
            </button>
          )}

          {step === 'installing' && (
            <button
              disabled
              className="px-4 py-2 text-sm bg-zinc-700 text-zinc-500 rounded-md cursor-not-allowed"
            >
              Updating...
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
