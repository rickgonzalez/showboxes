import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Viewer } from './Viewer';
import { GenerateFlow } from './pipeline/GenerateFlow';
import './index.css';

/**
 * Minimal path-based router.
 *   /generate        — the user-facing authoring flow (GenerateFlow)
 *   /viewer/:id      — the embed/share surface (Viewer, read-only)
 *   everything else  — internal exerciser App
 * No react-router dep needed — the surface count is small.
 */
function Root() {
  if (typeof window === 'undefined') return <App />;
  const path = window.location.pathname;

  if (path === '/generate' || path.startsWith('/generate/')) {
    return <GenerateFlow />;
  }

  const viewerMatch = path.match(/^\/viewer\/([A-Za-z0-9_-]+)\/?$/);
  if (viewerMatch) {
    const scriptId = viewerMatch[1];
    const token = new URLSearchParams(window.location.search).get('token');
    return <Viewer scriptId={scriptId} token={token} />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
