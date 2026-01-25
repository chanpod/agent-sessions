import React, { useState } from 'react';
import { X, Sparkles, Gem, Code, Loader2, CheckCircle, XCircle, Terminal } from 'lucide-react';

interface AgentInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  uninstalledAgents: Array<{ id: string; name: string }>;
  platform: 'windows' | 'wsl' | 'macos' | 'linux';
  onInstallComplete: () => void;
  onInstall: (agentId: string, method: 'npm' | 'native' | 'brew') => Promise<{ success: boolean; output: string }>;
}

type InstallStep = 'select-agent' | 'select-method' | 'installing' | 'result';

interface InstallMethod {
  id: 'npm' | 'native' | 'brew';
  name: string;
  command: string;
  recommended: boolean;
  available: boolean;
  requirement?: string;
}

const AGENT_ICONS: Record<string, React.ReactNode> = {
  claude: <Sparkles className="w-5 h-5 text-amber-400" />,
  gemini: <Gem className="w-5 h-5 text-blue-400" />,
  codex: <Code className="w-5 h-5 text-green-400" />,
};

const getInstallMethods = (
  agentId: string,
  platform: 'windows' | 'wsl' | 'macos' | 'linux'
): InstallMethod[] => {
  const isMac = platform === 'macos';

  switch (agentId) {
    case 'claude':
      // Native installer is recommended for all platforms
      return [
        {
          id: 'native' as const,
          name: platform === 'windows' ? 'PowerShell Installer' : 'Native Installer (curl)',
          command:
            platform === 'windows'
              ? 'irm https://claude.ai/install.ps1 | iex'
              : 'curl -fsSL https://claude.ai/install.sh | bash',
          recommended: true,
          available: true,
        },
        {
          id: 'npm' as const,
          name: 'npm (Node.js)',
          command: 'npm i -g @anthropic-ai/claude-code',
          recommended: false,
          available: true,
          requirement: 'Node.js 18+',
        },
      ];
    case 'gemini':
      // npm is recommended, brew available only on macOS
      return ([
        {
          id: 'npm' as const,
          name: 'npm (Node.js)',
          command: 'npm i -g @google/gemini-cli',
          recommended: true,
          available: true,
          requirement: 'Node.js 20+',
        },
        {
          id: 'brew' as const,
          name: 'Homebrew',
          command: 'brew install gemini-cli',
          recommended: false,
          available: isMac,
        },
      ] as InstallMethod[]).filter((m) => m.available);
    case 'codex':
      // npm is recommended, brew available only on macOS
      return ([
        {
          id: 'npm' as const,
          name: 'npm (Node.js)',
          command: 'npm i -g @openai/codex',
          recommended: true,
          available: true,
        },
        {
          id: 'brew' as const,
          name: 'Homebrew Cask',
          command: 'brew install --cask codex',
          recommended: false,
          available: isMac,
        },
      ] as InstallMethod[]).filter((m) => m.available);
    default:
      return [];
  }
};

const getNodeRequirement = (agentId: string): string | null => {
  switch (agentId) {
    case 'claude':
      return 'Node.js 18+ (for npm method)';
    case 'gemini':
      return 'Node.js 20+ (for npm method)';
    case 'codex':
      return null; // No specific requirement shown at agent level
    default:
      return null;
  }
};

export const AgentInstallModal: React.FC<AgentInstallModalProps> = ({
  isOpen,
  onClose,
  uninstalledAgents,
  platform,
  onInstallComplete,
  onInstall,
}) => {
  const [step, setStep] = useState<InstallStep>('select-agent');
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string } | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<InstallMethod | null>(null);
  const [installOutput, setInstallOutput] = useState('');
  const [installSuccess, setInstallSuccess] = useState<boolean | null>(null);

  const resetState = () => {
    setStep('select-agent');
    setSelectedAgent(null);
    setSelectedMethod(null);
    setInstallOutput('');
    setInstallSuccess(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleAgentSelect = (agent: { id: string; name: string }) => {
    setSelectedAgent(agent);
    setStep('select-method');
  };

  const handleMethodSelect = (method: InstallMethod) => {
    setSelectedMethod(method);
  };

  const handleInstall = async () => {
    if (!selectedAgent || !selectedMethod) return;

    setStep('installing');
    setInstallOutput('Starting installation...\n');

    try {
      const result = await onInstall(selectedAgent.id, selectedMethod.id);
      setInstallOutput(result.output);
      setInstallSuccess(result.success);
      setStep('result');

      // Don't call onInstallComplete here - let the user see the result first
      // The "Done" button will call onInstallComplete when clicked
    } catch (error) {
      setInstallOutput(`Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setInstallSuccess(false);
      setStep('result');
    }
  };

  const handleBack = () => {
    if (step === 'select-method') {
      setSelectedAgent(null);
      setSelectedMethod(null);
      setStep('select-agent');
    }
  };

  if (!isOpen) return null;

  const installMethods = selectedAgent ? getInstallMethods(selectedAgent.id, platform) : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-200">
            {step === 'select-agent' && 'Install AI Agent'}
            {step === 'select-method' && `Install ${selectedAgent?.name}`}
            {step === 'installing' && `Installing ${selectedAgent?.name}...`}
            {step === 'result' && (installSuccess ? 'Installation Complete' : 'Installation Failed')}
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
          {/* Step 1: Select Agent */}
          {step === 'select-agent' && (
            <div className="space-y-2">
              {uninstalledAgents.length === 0 ? (
                <div className="text-center py-8 text-zinc-400">
                  All supported agents are already installed.
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-400 mb-4">
                    Select an AI agent to install:
                  </p>
                  {uninstalledAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleAgentSelect(agent)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
                    >
                      <div className="flex-shrink-0">
                        {AGENT_ICONS[agent.id] || <Code className="w-5 h-5 text-zinc-400" />}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-zinc-200 font-medium">{agent.name}</div>
                        <div className="text-xs text-zinc-500">Click to install</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Step 2: Select Installation Method */}
          {step === 'select-method' && selectedAgent && (
            <div className="space-y-4">
              <button
                onClick={handleBack}
                className="text-sm text-zinc-400 hover:text-zinc-200 mb-2"
              >
                &larr; Back to agent selection
              </button>

              <div className="flex items-center gap-3 mb-4">
                {AGENT_ICONS[selectedAgent.id]}
                <span className="text-zinc-200 font-medium">{selectedAgent.name}</span>
              </div>

              {getNodeRequirement(selectedAgent.id) && (
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 mb-4">
                  <div className="text-xs text-zinc-400">Platform Requirements</div>
                  <div className="text-sm text-zinc-200">{getNodeRequirement(selectedAgent.id)}</div>
                </div>
              )}

              <p className="text-sm text-zinc-400 mb-2">Select installation method:</p>

              <div className="space-y-2">
                {installMethods.map((method) => (
                  <button
                    key={method.id}
                    onClick={() => handleMethodSelect(method)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      selectedMethod?.id === method.id
                        ? 'bg-blue-600/20 border-blue-500 text-zinc-200'
                        : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {method.name}
                        {method.recommended && (
                          <span className="ml-2 text-xs text-green-400">(Recommended)</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-zinc-400 bg-zinc-900/50 px-2 py-1 rounded">
                      {method.command}
                    </div>
                    {method.requirement && (
                      <div className="mt-1 text-xs text-zinc-500">
                        Requires {method.requirement}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Installing */}
          {step === 'installing' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3 py-4">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                <span className="text-zinc-200">Installing {selectedAgent?.name}...</span>
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

          {/* Step 4: Result */}
          {step === 'result' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3 py-4">
                {installSuccess ? (
                  <>
                    <CheckCircle className="w-8 h-8 text-green-400" />
                    <div className="text-center">
                      <div className="text-zinc-200 font-medium">
                        {selectedAgent?.name} installed successfully!
                      </div>
                      <div className="text-sm text-zinc-400">
                        You can now use this agent in your workspace.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="w-8 h-8 text-red-400" />
                    <div className="text-center">
                      <div className="text-zinc-200 font-medium">Installation failed</div>
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
          {step === 'select-agent' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          )}

          {step === 'select-method' && (
            <>
              <button
                onClick={handleBack}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                disabled={!selectedMethod}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md transition-colors"
              >
                Install Now
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
                  onClick={() => setStep('select-method')}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Try Again
                </button>
              )}
              <button
                onClick={() => {
                  // Notify parent to refresh agent detection on success
                  if (installSuccess) {
                    onInstallComplete();
                  }
                  handleClose();
                }}
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

export default AgentInstallModal;
