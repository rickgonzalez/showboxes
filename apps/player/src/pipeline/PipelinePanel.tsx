import { useEffect, useState } from 'react';
import type {
  AnalysisMode,
  AnalysisSummary,
  PresentationScript,
  ScriptSummary,
  TriageReport,
} from '@showboxes/shared-types';
import {
  getAnalysis,
  getScript,
  listAnalyses,
  listScripts,
  pollAnalysis,
  postScript,
  runTriage,
  startAnalyze,
} from './api';
import { TriageModal } from './TriageModal';
import {
  clearAnalysis,
  clearLatestForRepo,
  loadAnalysisById,
  latestIdForRepo,
  saveAnalysis,
} from './cache';
import { JsonView } from './JsonView';
import { defaultSettings, type AnalysisJSON, type UserSettings } from './types';

type Stage = 'idle' | 'triaging' | 'analyzing' | 'scripting';
type Tab = 'none' | 'analysis' | 'script' | 'settings';

interface PipelinePanelProps {
  onPlayScript: (
    script: PresentationScript,
    meta?: { scriptId?: string | null; analysisId?: string | null },
  ) => void;
  canPlay: boolean;
}

export function PipelinePanel({ onPlayScript, canPlay }: PipelinePanelProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisJSON | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<AnalysisSummary[]>([]);
  const [script, setScript] = useState<PresentationScript | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [savedScripts, setSavedScripts] = useState<ScriptSummary[]>([]);
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('none');
  const [analyzeProgress, setAnalyzeProgress] = useState<string>('');
  const [triageReport, setTriageReport] = useState<TriageReport | null>(null);

  // When the repo URL changes, refresh the version list and default to
  // the last-used analysis (from localStorage) if we have one.
  useEffect(() => {
    let cancelled = false;
    setScript(null);

    const latestId = latestIdForRepo(repoUrl);
    if (latestId) {
      const cached = loadAnalysisById(latestId);
      setSelectedId(latestId);
      setAnalysis(cached);
    } else {
      setSelectedId(null);
      setAnalysis(null);
    }

    // When repoUrl is empty, list across all repos so the dropdown
    // shows saved analyses the user can jump back into. When it's set,
    // filter to that repo.
    const filter = repoUrl.trim() || undefined;
    listAnalyses(filter)
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('listAnalyses failed', e);
      });

    return () => {
      cancelled = true;
    };
  }, [repoUrl]);

  // Refresh the saved-scripts dropdown whenever the selected analysis
  // changes. Scripts are scoped to the currently selected analysis.
  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setSavedScripts([]);
      setSelectedScriptId(null);
      return () => {
        cancelled = true;
      };
    }
    listScripts({ analysisId: selectedId })
      .then((list) => {
        if (cancelled) return;
        setSavedScripts(list);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('listScripts failed', e);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refreshScripts = async () => {
    if (!selectedId) return;
    try {
      const list = await listScripts({ analysisId: selectedId });
      setSavedScripts(list);
    } catch (e) {
      console.warn('listScripts failed', e);
    }
  };

  const selectScript = async (id: string) => {
    setError(null);
    setSelectedScriptId(id);
    try {
      const record = await getScript(id);
      if (record.status !== 'ready' || !record.data) {
        setScript(null);
        setError(record.error ?? `script is ${record.status}`);
        return;
      }
      setScript(record.data);
      setTab('script');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const refreshVersions = async () => {
    try {
      const list = await listAnalyses(repoUrl);
      setVersions(list);
    } catch (e) {
      console.warn('listAnalyses failed', e);
    }
  };

  const selectVersion = async (id: string) => {
    setError(null);
    setSelectedId(id);
    setScript(null);
    setSelectedScriptId(null);

    // If the user picked a version while browsing all repos (empty
    // repoUrl), populate the URL field so the rest of the UI knows
    // which repo this analysis belongs to.
    const summary = versions.find((v) => v.id === id);
    if (summary && summary.repoUrl !== repoUrl) {
      setRepoUrl(summary.repoUrl);
    }

    const cached = loadAnalysisById(id);
    if (cached) {
      setAnalysis(cached);
      return;
    }

    try {
      const record = await getAnalysis(id);
      if (record.status !== 'ready' || !record.data) {
        setAnalysis(null);
        setError(
          record.status === 'error'
            ? (record.error ?? 'analysis errored')
            : `analysis is ${record.status}`,
        );
        return;
      }
      setAnalysis(record.data);
      saveAnalysis(record.id, record.repoUrl, record.data);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runAnalyze = async () => {
    setError(null);
    setStage('triaging');
    setAnalyzeProgress('scouting repo…');
    try {
      const report = await runTriage(repoUrl);
      setTriageReport(report);
      setStage('idle');
      setAnalyzeProgress('');
      // Modal takes over from here; it calls runDeepAnalysis on confirm.
    } catch (e) {
      setError((e as Error).message);
      setStage('idle');
      setAnalyzeProgress('');
    }
  };

  const runDeepAnalysis = async (mode: AnalysisMode) => {
    // Capture before we clear it — the server uses the report for the
    // tunables trace on the Analysis row.
    const report = triageReport ?? undefined;
    setTriageReport(null);
    setError(null);
    setStage('analyzing');
    setAnalyzeProgress('starting session…');
    try {
      const { id } = await startAnalyze(repoUrl, mode, report);
      setAnalyzeProgress(`running (id ${id.slice(0, 8)}…)`);
      await refreshVersions();
      const record = await pollAnalysis(id, {
        onTick: (r) => {
          if (r.status === 'running') {
            setAnalyzeProgress(
              `agent running · ${Math.round(
                (Date.now() - new Date(r.createdAt).getTime()) / 1000,
              )}s`,
            );
          }
        },
      });
      if (record.status === 'error' || !record.data) {
        throw new Error(record.error ?? 'analysis returned no data');
      }
      setAnalysis(record.data);
      setSelectedId(record.id);
      saveAnalysis(record.id, record.repoUrl, record.data);
      await refreshVersions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage('idle');
      setAnalyzeProgress('');
    }
  };

  const runScript = async () => {
    if (!analysis) return;
    setError(null);
    setStage('scripting');
    try {
      const result = await postScript(analysis, settings, selectedId ?? undefined);
      setScript(result.script);
      setSelectedScriptId(result.id);
      setTab('script');
      if (result.id) void refreshScripts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage('idle');
    }
  };

  const play = () => {
    if (script) {
      onPlayScript(script, {
        scriptId: selectedScriptId,
        analysisId: selectedId,
      });
    }
  };

  const forgetCache = () => {
    if (selectedId) clearAnalysis(selectedId);
    clearLatestForRepo(repoUrl);
    setAnalysis(null);
    setSelectedId(null);
    setScript(null);
  };

  const toggle = (t: Tab) => setTab((cur) => (cur === t ? 'none' : t));

  return (
    <div className="sb-pipeline">
      <div className="sb-pipeline-bar">
        <span className="sb-toolbar-label">Pipeline</span>
        <input
          className="sb-pipeline-url"
          placeholder="github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <select
          className="sb-pipeline-versions"
          value={selectedId ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            if (id) void selectVersion(id);
          }}
          disabled={versions.length === 0}
          title="Prior analyses for this repo"
        >
          <option value="" disabled>
            {versions.length === 0
              ? 'no saved analyses'
              : `${versions.length} version${versions.length === 1 ? '' : 's'}`}
          </option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {formatVersionLabel(v, !repoUrl.trim())}
            </option>
          ))}
        </select>
        <button
          onClick={runAnalyze}
          disabled={
            stage === 'analyzing' ||
            stage === 'triaging' ||
            !repoUrl.trim()
          }
          title="Scout the repo, then pick a focus for the deep analysis."
        >
          {stage === 'triaging'
            ? 'scouting…'
            : stage === 'analyzing'
              ? 'analyzing…'
              : 'analyze'}
        </button>
        <button onClick={forgetCache} disabled={!selectedId}>
          forget
        </button>
        {analyzeProgress && (
          <span className="sb-toolbar-label">{analyzeProgress}</span>
        )}
        <span className="sb-pipeline-sep" />
        <button onClick={runScript} disabled={!analysis || stage === 'scripting'}>
          {stage === 'scripting' ? 'generating…' : 'generate script'}
        </button>
        <select
          className="sb-pipeline-versions"
          value={selectedScriptId ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            if (id) void selectScript(id);
          }}
          disabled={!selectedId || savedScripts.length === 0}
          title="Saved scripts for this analysis"
        >
          <option value="" disabled>
            {!selectedId
              ? 'pick an analysis first'
              : savedScripts.length === 0
                ? 'no saved scripts'
                : `${savedScripts.length} script${savedScripts.length === 1 ? '' : 's'}`}
          </option>
          {savedScripts.map((s) => (
            <option key={s.id} value={s.id}>
              {formatScriptLabel(s)}
            </option>
          ))}
        </select>
        <button onClick={play} disabled={!script || !canPlay}>
          ▶ load into player
        </button>
        <span className="sb-pipeline-sep" />
        <button
          className={tab === 'analysis' ? 'sb-pipeline-tab-active' : ''}
          onClick={() => toggle('analysis')}
          disabled={!analysis}
        >
          analysis {analysis ? '●' : '○'}
        </button>
        <button
          className={tab === 'script' ? 'sb-pipeline-tab-active' : ''}
          onClick={() => toggle('script')}
          disabled={!script}
        >
          script {script ? `● ${script.scenes.length}` : '○'}
        </button>
        <button
          className={tab === 'settings' ? 'sb-pipeline-tab-active' : ''}
          onClick={() => toggle('settings')}
        >
          settings
        </button>
      </div>

      {error && <div className="sb-pipeline-error">{error}</div>}

      {tab !== 'none' && (
        <div className="sb-pipeline-drawer">
          {tab === 'analysis' && analysis && (
            <JsonView
              label="analysis"
              value={analysis}
              height={360}
              onChange={(next) => setAnalysis(next as AnalysisJSON)}
            />
          )}
          {tab === 'script' && script && (
            <JsonView
              label="script"
              value={script}
              height={360}
              onChange={(next) => setScript(next as PresentationScript)}
            />
          )}
          {tab === 'settings' && (
            <SettingsRow settings={settings} onChange={setSettings} />
          )}
        </div>
      )}

      {triageReport && (
        <TriageModal
          report={triageReport}
          onConfirm={(mode) => void runDeepAnalysis(mode)}
          onCancel={() => setTriageReport(null)}
        />
      )}
    </div>
  );
}

function formatVersionLabel(
  v: AnalysisSummary,
  includeRepo: boolean,
): string {
  const d = new Date(v.createdAt);
  const stamp = `${d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
  const repo = includeRepo ? `${shortRepo(v.repoUrl)} · ` : '';
  const agent = v.agentVersion ? ` · agent ${v.agentVersion.slice(0, 7)}` : '';
  const status = v.status === 'ready' ? '' : ` · ${v.status}`;
  return `${repo}${stamp}${agent}${status}`;
}

function formatScriptLabel(s: ScriptSummary): string {
  const d = new Date(s.createdAt);
  const stamp = `${d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
  const status = s.status === 'ready' ? '' : ` · ${s.status}`;
  return `${s.persona} · ${stamp}${status}`;
}

function shortRepo(url: string): string {
  // Trim protocol/host so the dropdown stays readable.
  return url.replace(/^https?:\/\//, '').replace(/^github\.com\//, '');
}

interface SettingsRowProps {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
}

function SettingsRow({ settings, onChange }: SettingsRowProps) {
  const patch = (p: Partial<UserSettings>) => onChange({ ...settings, ...p });
  return (
    <div className="sb-pipeline-settings">
      <label>
        persona
        <select
          value={settings.persona}
          onChange={(e) => patch({ persona: e.target.value as UserSettings['persona'] })}
        >
          <option value="friendly">friendly</option>
          <option value="corporate">corporate</option>
          <option value="character">character</option>
          <option value="stern">stern</option>
        </select>
      </label>
      <label>
        audience {settings.audienceLevel.toFixed(1)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={settings.audienceLevel}
          onChange={(e) => patch({ audienceLevel: Number(e.target.value) })}
        />
      </label>
      <label>
        detail {settings.detailLevel.toFixed(1)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={settings.detailLevel}
          onChange={(e) => patch({ detailLevel: Number(e.target.value) })}
        />
      </label>
      <label>
        pace {settings.pace.toFixed(1)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={settings.pace}
          onChange={(e) => patch({ pace: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
