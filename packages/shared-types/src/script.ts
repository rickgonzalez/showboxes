export type Persona = 'corporate' | 'character' | 'friendly' | 'stern';

export type AnalysisSection =
  | 'quickFacts'
  | 'architecture'
  | 'codeQuality'
  | 'plainEnglish'
  | 'health';

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  code: string;
}

export interface TransitionSpec {
  type: 'cut' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'dissolve';
  durationMs: number;
}

export interface VoiceConfig {
  provider: 'elevenlabs' | 'kokoro' | 'stub';
  voiceId: string;
  /** 0.5 slow, 1.0 normal, 1.5 fast */
  speed: number;
}

export type BeatAction =
  | { type: 'emphasize'; target: string }
  | { type: 'highlight-line'; line: number }
  | { type: 'reveal'; index: number }
  | { type: 'annotate'; text: string; position: 'top' | 'bottom' | 'left' | 'right' }
  | { type: 'fx'; name: string; params?: Record<string, unknown> };

export interface Beat {
  /** Seconds after scene start */
  at: number;
  action: BeatAction;
}

/**
 * Primitive content is intentionally untyped in the shared contract.
 * The player narrows it against its template registry at runtime; the
 * server produces JSON that passes through. If you want strict typing
 * on the player side, import the player's TemplateContent and cast.
 */
export interface PrimitiveSpec {
  template: string;
  content: Record<string, unknown>;
}

export interface Scene {
  id: string;
  section: AnalysisSection;
  primitive: PrimitiveSpec;
  narration: string;
  /** Minimum seconds to hold the scene */
  holdSeconds: number;
  transition?: TransitionSpec;
  beats?: Beat[];
}

export type ScriptStatus = 'ready' | 'error';

/**
 * Persisted wrapper around a generated script. Scripts are stored
 * independently of their source analysis so a user can re-run ones
 * that work. `analysisId` is advisory — it records which analysis
 * produced this script, but the script remains loadable even if that
 * analysis row is later deleted.
 */
export interface ScriptRecord {
  id: string;
  analysisId: string | null;
  repoUrl: string;
  commitSha: string | null;
  label: string;
  persona: string;
  status: ScriptStatus;
  data: PresentationScript | null;
  focusInstructions: string | null;
  producerModel: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight list entry for the scripts dropdown. Omits `data`. */
export interface ScriptSummary {
  id: string;
  analysisId: string | null;
  repoUrl: string;
  label: string;
  persona: string;
  status: ScriptStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PresentationScript {
  meta: {
    title: string;
    repoUrl: string;
    generatedAt: string;
    persona: Persona;
    estimatedDuration: number;
  };
  defaults: {
    palette: Palette;
    transition: TransitionSpec;
    voice: VoiceConfig;
  };
  scenes: Scene[];
}
