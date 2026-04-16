import type { Persona } from './script';

export interface UserSettings {
  /** 0.0 = non-technical, 1.0 = senior architect */
  audienceLevel: number;
  /** 0.0 = executive summary, 1.0 = deep dive */
  detailLevel: number;
  /** 0.0 = slow/deliberate, 1.0 = fast/dense */
  pace: number;
  persona: Persona;
  voice: {
    provider: 'stub' | 'elevenlabs' | 'kokoro' | 'google-neural2';
    voiceId: string;
    speed: number;
  };
  focusAreas?: string[];
}

export const defaultSettings: UserSettings = {
  audienceLevel: 0.5,
  detailLevel: 0.5,
  pace: 0.4,
  persona: 'friendly',
  voice: { provider: 'stub', voiceId: 'stub-1', speed: 1.0 },
};
