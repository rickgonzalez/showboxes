import { useEffect, useState } from 'react';

interface JsonViewProps {
  value: unknown;
  /** Called with parsed JSON when the user commits edits. */
  onChange?: (next: unknown) => void;
  /** Height for the editor/viewer, in px. */
  height?: number;
  /** Label shown above the viewer. */
  label?: string;
}

export function JsonView({ value, onChange, height = 320, label }: JsonViewProps) {
  const pretty = (() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pretty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(pretty);
  }, [pretty, editing]);

  const commit = () => {
    try {
      const parsed = JSON.parse(draft);
      setError(null);
      setEditing(false);
      onChange?.(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cancel = () => {
    setDraft(pretty);
    setError(null);
    setEditing(false);
  };

  const copy = () => {
    void navigator.clipboard?.writeText(pretty);
  };

  const download = () => {
    const blob = new Blob([pretty], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label ?? 'data'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sb-json-view">
      <div className="sb-json-toolbar">
        {label && <span className="sb-json-label">{label}</span>}
        <div className="sb-json-actions">
          {!editing && onChange && (
            <button onClick={() => setEditing(true)}>edit</button>
          )}
          {editing && (
            <>
              <button onClick={commit}>apply</button>
              <button onClick={cancel}>cancel</button>
            </>
          )}
          <button onClick={copy} disabled={editing}>copy</button>
          <button onClick={download} disabled={editing}>download</button>
        </div>
      </div>
      {editing ? (
        <textarea
          className="sb-json-editor"
          style={{ height }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <pre className="sb-json-pre" style={{ height }}>
          {pretty}
        </pre>
      )}
      {error && <div className="sb-json-error">parse error: {error}</div>}
    </div>
  );
}
