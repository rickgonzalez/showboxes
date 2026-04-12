'use client';

import { useState } from 'react';

interface AssignAgentModalProps {
  taskId: string;
  taskTitle: string;
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignAgentModal({
  taskId,
  taskTitle,
  onClose,
  onAssigned,
}: AssignAgentModalProps) {
  const [agentConfig, setAgentConfig] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      let config: Record<string, unknown> | undefined;

      if (agentConfig.trim()) {
        try {
          config = JSON.parse(agentConfig);
        } catch {
          throw new Error('Invalid JSON format for agent config');
        }
      }

      const response = await fetch(`/api/tasks/${taskId}/assign-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentConfig: config,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-[#1a1f16] rounded-xl shadow-xl max-w-md w-full mx-4 p-6 border border-[#2a2f24]">
        <h2 className="text-lg font-semibold text-[#e8e6e1] mb-2">Assign AI Agent</h2>

        <div className="mb-4">
          <p className="text-sm text-[#e8e6e1]/85 mb-3">
            <span className="block font-medium text-[#e8e6e1] mb-1">Task: {taskTitle}</span>
            Assign an AI agent to this task. The agent will generate an execution plan for your
            review before taking any action.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Advanced Config Section */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs uppercase tracking-wider opacity-70 hover:opacity-90 transition-opacity flex items-center gap-2 mb-2"
            >
              <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>
                ▶
              </span>
              Advanced Configuration
            </button>

            {showAdvanced && (
              <div>
                <label className="text-xs uppercase tracking-wider opacity-70 mb-1 block">
                  JSON Config (Optional)
                </label>
                <textarea
                  value={agentConfig}
                  onChange={(e) => setAgentConfig(e.target.value)}
                  className="w-full bg-[#0c0f0a] border border-[#2a2f24] rounded-lg px-3 py-2 text-[#e8e6e1] focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30 transition-colors resize-none font-mono text-xs"
                  rows={4}
                  placeholder={`{
  "timeout": 300,
  "model": "claude-opus"
}`}
                />
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 bg-transparent border border-[#2a2f24] text-[#e8e6e1]/80 hover:text-[#e8e6e1] rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Assigning...' : 'Assign Gnome'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
