import type { AnalysisJSON } from './types';

/**
 * Client-side cache of fetched analyses, keyed by analysis id so
 * multiple versions for the same repo coexist. A separate "latest id
 * per repo" index gives the panel a fast answer to "what's the most
 * recent analysis I've seen for this URL?" without a server round-trip.
 */

const DATA_KEY = (id: string) => `showboxes:analysis:id:${id}`;
const LATEST_KEY = (repoUrl: string) => `showboxes:analysis:latest:${repoUrl}`;

export function saveAnalysis(
  id: string,
  repoUrl: string,
  analysis: AnalysisJSON,
): void {
  try {
    localStorage.setItem(DATA_KEY(id), JSON.stringify(analysis));
    localStorage.setItem(LATEST_KEY(repoUrl), id);
  } catch {
    /* quota or disabled — non-fatal */
  }
}

export function loadAnalysisById(id: string): AnalysisJSON | null {
  try {
    const raw = localStorage.getItem(DATA_KEY(id));
    return raw ? (JSON.parse(raw) as AnalysisJSON) : null;
  } catch {
    return null;
  }
}

export function latestIdForRepo(repoUrl: string): string | null {
  try {
    return localStorage.getItem(LATEST_KEY(repoUrl));
  } catch {
    return null;
  }
}

export function loadLatestAnalysis(repoUrl: string): AnalysisJSON | null {
  const id = latestIdForRepo(repoUrl);
  return id ? loadAnalysisById(id) : null;
}

export function clearAnalysis(id: string): void {
  try {
    localStorage.removeItem(DATA_KEY(id));
  } catch {
    /* noop */
  }
}

export function clearLatestForRepo(repoUrl: string): void {
  try {
    localStorage.removeItem(LATEST_KEY(repoUrl));
  } catch {
    /* noop */
  }
}
