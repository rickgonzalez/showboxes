import { useState } from 'react';
import {
  DEFAULT_DEPTH,
  LARGE_REPO_FILE_THRESHOLD,
  type AnalysisMode,
  type TriageReport,
} from '@showboxes/shared-types';

interface TriageModalProps {
  report: TriageReport;
  onConfirm: (mode: AnalysisMode) => void;
  onCancel: () => void;
}

type ModeKind = AnalysisMode['kind'];

/**
 * After triage completes, show this modal so the user can pick how the
 * analysis should focus. Four choices:
 *   1. overview       — broad tour, ~30 files
 *   2. focused-brief  — pick 1-3 subsystems + dial depth slider
 *   3. scorecard      — quality + health emphasis
 *   4. walkthrough    — pick one entry point, trace it end-to-end
 *
 * The modal is intentionally minimal styling — inherits the app's
 * existing toolbar look via sb-* classes where possible.
 */
export function TriageModal({ report, onConfirm, onCancel }: TriageModalProps) {
  const defaultKind: ModeKind =
    report.totalFiles > LARGE_REPO_FILE_THRESHOLD ? 'focused-brief' : 'overview';

  const [kind, setKind] = useState<ModeKind>(defaultKind);

  // focused-brief: preselect top-3 by importance if present, else first 3.
  const sortedSubsystems = [...report.subsystems].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0),
  );
  const defaultPicked = sortedSubsystems.slice(0, 3).map((s) => s.name);
  const [picked, setPicked] = useState<string[]>(defaultPicked);

  // depth: 0 = brief, 1 = thorough. Fed into renderModeDirective server-side.
  const [depth, setDepth] = useState<number>(DEFAULT_DEPTH);

  // walkthrough: default to the first entry point.
  const [entryPoint, setEntryPoint] = useState<string>(
    report.entryPoints[0]?.file ?? '',
  );

  const togglePick = (name: string) => {
    setPicked((cur) =>
      cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name],
    );
  };

  const buildMode = (): AnalysisMode | null => {
    switch (kind) {
      case 'overview':
        return { kind: 'overview' };
      case 'scorecard':
        return { kind: 'scorecard' };
      case 'focused-brief':
        if (picked.length === 0) return null;
        return { kind: 'focused-brief', subsystems: picked, depth };
      case 'walkthrough':
        if (!entryPoint) return null;
        return { kind: 'walkthrough', entryPoint };
    }
  };

  const canConfirm = buildMode() !== null;

  return (
    <div className="sb-modal-backdrop" onClick={onCancel}>
      <div className="sb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sb-modal-header">
          <h2>Focus the analysis</h2>
          <button className="sb-modal-close" onClick={onCancel}>
            ×
          </button>
        </div>

        <TriageSummary report={report} />

        <div className="sb-modal-section">
          <div className="sb-modal-section-label">Mode</div>
          <div className="sb-modal-modes">
            <ModeCard
              selected={kind === 'overview'}
              title="High-level overview"
              hint="Broad tour, ~30 files. Good for non-technical audiences."
              onClick={() => setKind('overview')}
            />
            <ModeCard
              selected={kind === 'focused-brief'}
              title="Focused brief"
              hint="Pick 1-3 subsystems. Dial the slider for how deep to go."
              onClick={() => setKind('focused-brief')}
            />
            <ModeCard
              selected={kind === 'scorecard'}
              title="Scorecard"
              hint="Quality + health emphasis. Is this repo any good?"
              onClick={() => setKind('scorecard')}
            />
            <ModeCard
              selected={kind === 'walkthrough'}
              title="Guided walkthrough"
              hint="Trace one entry point end-to-end as a user journey."
              onClick={() => setKind('walkthrough')}
            />
          </div>
        </div>

        {kind === 'focused-brief' && (
          <>
            <div className="sb-modal-section">
              <div className="sb-modal-section-label">
                Subsystems ({picked.length} selected)
              </div>
              <div className="sb-modal-subsystems">
                {sortedSubsystems.map((s) => (
                  <label
                    key={s.name}
                    className={`sb-modal-subsystem ${
                      picked.includes(s.name) ? 'sb-modal-subsystem-picked' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(s.name)}
                      onChange={() => togglePick(s.name)}
                    />
                    <div className="sb-modal-subsystem-body">
                      <div className="sb-modal-subsystem-name">
                        {s.name}
                        {typeof s.importance === 'number' && (
                          <span className="sb-modal-subsystem-weight">
                            {Math.round(s.importance * 100)}
                          </span>
                        )}
                      </div>
                      <div className="sb-modal-subsystem-purpose">{s.purpose}</div>
                      <div className="sb-modal-subsystem-paths">
                        {s.paths.join(', ')}
                        {typeof s.fileCount === 'number' &&
                          ` · ${s.fileCount} files`}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="sb-modal-section">
              <div className="sb-modal-section-label">
                Depth · ~{Math.round(15 + depth * 35)} files per subsystem
              </div>
              <div className="sb-modal-slider">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                />
                <div className="sb-modal-slider-ticks">
                  <span>Brief</span>
                  <span>Standard</span>
                  <span>Detailed</span>
                </div>
              </div>
            </div>
          </>
        )}

        {kind === 'walkthrough' && (
          <div className="sb-modal-section">
            <div className="sb-modal-section-label">Entry point</div>
            <select
              className="sb-modal-select"
              value={entryPoint}
              onChange={(e) => setEntryPoint(e.target.value)}
            >
              {report.entryPoints.map((e) => (
                <option key={e.file} value={e.file}>
                  {e.file} — {e.role}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sb-modal-footer">
          <button onClick={onCancel}>cancel</button>
          <button
            className="sb-modal-primary"
            disabled={!canConfirm}
            onClick={() => {
              const mode = buildMode();
              if (mode) onConfirm(mode);
            }}
          >
            run deep analysis
          </button>
        </div>
      </div>
    </div>
  );
}

function TriageSummary({ report }: { report: TriageReport }) {
  return (
    <div className="sb-modal-summary">
      <div className="sb-modal-summary-row">
        <strong>{report.repoUrl}</strong>
      </div>
      <div className="sb-modal-summary-row sb-modal-summary-stats">
        <span>{report.totalFiles.toLocaleString()} files</span>
        <span>~{report.approxLines.toLocaleString()} lines</span>
        {report.framework && <span>{report.framework}</span>}
        {report.buildTool && <span>{report.buildTool}</span>}
        <span>
          {report.languages
            .slice(0, 3)
            .map((l) => `${l.name} ${Math.round(l.share * 100)}%`)
            .join(' · ')}
        </span>
      </div>
      {report.highlights && report.highlights.length > 0 && (
        <ul className="sb-modal-highlights">
          {report.highlights.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
      {report.notes && <div className="sb-modal-notes">{report.notes}</div>}
    </div>
  );
}

interface ModeCardProps {
  selected: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}

function ModeCard({ selected, title, hint, onClick }: ModeCardProps) {
  return (
    <button
      className={`sb-modal-mode ${selected ? 'sb-modal-mode-selected' : ''}`}
      onClick={onClick}
    >
      <div className="sb-modal-mode-title">{title}</div>
      <div className="sb-modal-mode-hint">{hint}</div>
    </button>
  );
}
