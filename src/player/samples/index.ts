import type { PresentationScript, Palette, TransitionSpec, VoiceConfig } from '../types';

const palette: Palette = {
  primary: '#3b82f6',
  secondary: '#a855f7',
  accent: '#f59e0b',
  background: '#0f172a',
  text: '#f8fafc',
  code: '#94a3b8',
};

const defaultTransition: TransitionSpec = { type: 'fade', durationMs: 400 };
const voice: VoiceConfig = { provider: 'stub', voiceId: 'stub-1', speed: 1.0 };

/**
 * Short script — 3 scenes, quick facts only. Good for sanity check.
 */
export const quickScript: PresentationScript = {
  meta: {
    title: 'showboxes — quick tour',
    repoUrl: 'local://showboxes',
    generatedAt: new Date().toISOString(),
    persona: 'friendly',
    estimatedDuration: 18,
  },
  defaults: { palette, transition: defaultTransition, voice },
  scenes: [
    {
      id: 'intro',
      section: 'quickFacts',
      primitive: {
        template: 'title-bullets',
        content: {
          title: 'What is showboxes?',
          bullets: [
            'A presentation engine for code explanations.',
            'Agent writes a script. Client plays it back.',
            'Canvas + DOM + 3D layers stitched together.',
          ],
          titleFx: [{ name: 'slam', duration: 520 }],
        },
      },
      narration:
        'Showboxes turns an analysis of a codebase into a short animated presentation. An agent writes the script, and the client plays it back.',
      holdSeconds: 5,
      beats: [{ at: 2.0, action: { type: 'emphasize', target: '1' } }],
    },
    {
      id: 'verdict',
      section: 'codeQuality',
      primitive: {
        template: 'emphasis-word',
        content: {
          word: 'COMPOSABLE',
          subtitle: 'Primitives combine into any explanation shape.',
          fx: [
            { name: 'slam', duration: 520 },
            { name: 'glow', duration: 1400, strength: 40, color: '#3b82f6' },
          ],
          style: { size: 120, weight: '900', color: '#3b82f6' },
        },
      },
      narration: 'The key word here is composable. Every primitive is a small, focused building block.',
      holdSeconds: 4,
    },
    {
      id: 'outro',
      section: 'plainEnglish',
      primitive: {
        template: 'title-bullets',
        content: {
          title: 'Next up',
          bullets: ['Wire in a real TTS voice.', 'Connect the analyst agent.', 'Ship it.'],
        },
      },
      narration: 'Next, we wire in a real voice, connect the analyst agent, and ship the first end-to-end flow.',
      holdSeconds: 5,
    },
  ],
};

/**
 * Medium script — exercises a mix of primitives across analysis sections.
 */
export const mixedScript: PresentationScript = {
  meta: {
    title: 'A tour through a sample Express API',
    repoUrl: 'github.com/example/express-api',
    generatedAt: new Date().toISOString(),
    persona: 'corporate',
    estimatedDuration: 48,
  },
  defaults: { palette, transition: defaultTransition, voice },
  scenes: [
    {
      id: 's1',
      section: 'quickFacts',
      primitive: {
        template: 'title-bullets',
        content: {
          title: 'Express API — at a glance',
          bullets: [
            '18 route handlers across 6 files.',
            'PostgreSQL via Prisma.',
            'JWT auth, no refresh tokens.',
            '0% test coverage.',
          ],
        },
      },
      narration:
        'Here is the express API at a glance. Eighteen route handlers, postgres through prisma, JWT auth with no refresh tokens, and zero test coverage.',
      holdSeconds: 6,
      beats: [{ at: 4.5, action: { type: 'emphasize', target: '3' } }],
    },
    {
      id: 's2',
      section: 'architecture',
      primitive: {
        template: 'flow-diagram',
        content: {
          nodes: [
            { id: 'client', label: 'Browser', icon: '🖥', group: 'fe' },
            { id: 'api', label: 'Express', icon: '⚙', group: 'be' },
            { id: 'auth', label: 'Auth', icon: '🛡', group: 'be' },
            { id: 'db', label: 'Postgres', icon: '💾', group: 'data' },
          ],
          edges: [
            { from: 'client', to: 'api', label: 'REST' },
            { from: 'api', to: 'auth', label: 'verify' },
            { from: 'api', to: 'db', label: 'queries' },
          ],
          groups: [
            { id: 'fe', label: 'Frontend', color: 'palette.primary' },
            { id: 'be', label: 'Backend', color: 'palette.secondary' },
            { id: 'data', label: 'Data', color: 'palette.accent' },
          ],
          staggerMs: 300,
          layout: 'left-to-right',
        },
      },
      narration:
        'The architecture is the classic three-tier shape. Browser talks to express, express defers to auth for token verification, then reads and writes to postgres.',
      holdSeconds: 8,
      beats: [{ at: 5.0, action: { type: 'emphasize', target: 'auth' } }],
    },
    {
      id: 's2a',
      section: 'architecture',
      primitive: {
        template: 'entity-map',
        content: {
          title: 'Data model at a glance',
          entities: [
            { id: 'user', label: 'User', icon: '👤', fields: ['id', 'email', 'name'] },
            { id: 'org', label: 'Organization', icon: '🏢', fields: ['id', 'plan'] },
            {
              id: 'project',
              label: 'Project',
              icon: '📁',
              fields: ['id', 'name', 'orgId'],
            },
            {
              id: 'session',
              label: 'Session',
              icon: '🔑',
              fields: ['id', 'userId', 'exp'],
            },
          ],
          relationships: [
            { from: 'org', to: 'user', label: 'has many', type: 'one-to-many' },
            { from: 'org', to: 'project', label: 'has many', type: 'one-to-many' },
            { from: 'user', to: 'session', label: 'has many', type: 'one-to-many' },
          ],
          staggerMs: 300,
        },
      },
      narration:
        'On the data side, organizations own users and projects, and each user has a collection of sessions. Clean, flat, no surprises.',
      holdSeconds: 7,
      beats: [{ at: 4.0, action: { type: 'emphasize', target: 'session' } }],
    },
    {
      id: 's2b',
      section: 'architecture',
      primitive: {
        template: 'sequence-diagram',
        content: {
          title: 'Anatomy of a login',
          actors: [
            { id: 'user', label: 'User', icon: '👤' },
            { id: 'api', label: 'API', icon: '⚙' },
            { id: 'auth', label: 'Auth', icon: '🛡' },
            { id: 'db', label: 'DB', icon: '💾' },
          ],
          steps: [
            { from: 'user', to: 'api', label: 'POST /login', kind: 'request' },
            { from: 'api', to: 'auth', label: 'verify(pw)', kind: 'request' },
            { from: 'auth', to: 'db', label: 'SELECT user', kind: 'request' },
            { from: 'db', to: 'auth', label: 'row', kind: 'response' },
            { from: 'auth', to: 'api', label: '✓ valid', kind: 'response' },
            { from: 'api', to: 'api', label: 'sign JWT', kind: 'self' },
            { from: 'api', to: 'user', label: '200 + token', kind: 'response' },
          ],
          staggerMs: 700,
        },
      },
      narration:
        'Here is the login sequence. The browser posts credentials to the API, which hands off to the auth service, which reads the user row from postgres, decides, signs a JWT, and the response bubbles back.',
      holdSeconds: 10,
      beats: [
        { at: 3.0, action: { type: 'emphasize', target: '2' } },
        { at: 6.0, action: { type: 'emphasize', target: '5' } },
      ],
    },
    {
      id: 's2c',
      section: 'plainEnglish',
      primitive: {
        template: 'data-pipeline',
        content: {
          title: 'How the cart becomes a charge',
          input: {
            label: 'Line items',
            display: 'table',
            data: [
              { sku: 'A1', qty: 2, price: 12 },
              { sku: 'B3', qty: 1, price: 30 },
              { sku: 'C7', qty: 3, price: 5 },
            ],
          },
          stages: [
            {
              operation: 'map → qty × price',
              label: 'Line totals',
              display: 'table',
              highlight: 'total',
              result: [
                { sku: 'A1', qty: 2, price: 12, total: 24 },
                { sku: 'B3', qty: 1, price: 30, total: 30 },
                { sku: 'C7', qty: 3, price: 5, total: 15 },
              ],
            },
            {
              operation: 'reduce → sum',
              label: 'Subtotal',
              display: 'value',
              highlight: 'subtotal',
              result: { subtotal: 69 },
            },
            {
              operation: 'apply discount + tax',
              label: 'Grand total',
              display: 'breakdown',
              highlight: 'total',
              result: { subtotal: 69, discount: -5, tax: 5.76, total: 69.76 },
            },
          ],
          staggerMs: 1400,
        },
      },
      narration:
        'On the checkout path, the raw cart walks through three transforms: multiply out each line, sum the subtotal, apply discount and tax, and land on the grand total.',
      holdSeconds: 9,
      beats: [{ at: 6.0, action: { type: 'emphasize', target: '2' } }],
    },
    {
      id: 's3',
      section: 'codeQuality',
      primitive: {
        template: 'code-zoom',
        content: {
          code: 'export async function authenticate(req, res) {\n  const token = req.headers.authorization;\n  // no validation here\n  return jwt.decode(token);\n}',
          language: 'typescript',
          highlight: [3],
        },
      },
      narration:
        'Here is one of the concerns. The authenticate function pulls the token out of the header and decodes it, but never verifies the signature.',
      holdSeconds: 7,
      beats: [{ at: 3.0, action: { type: 'highlight-line', line: 4 } }],
    },
    {
      id: 's4',
      section: 'codeQuality',
      primitive: {
        template: 'purpose-bullets',
        content: {
          purpose: 'Handles auth and sessions',
          fileRef: 'src/services/auth.ts',
          supports: [
            { point: 'OAuth2 flow — Google and GitHub', type: 'feature' },
            { point: 'JWT, 24-hour expiry', type: 'detail' },
            { point: 'No refresh token rotation', type: 'concern' },
            { point: 'Rate-limited login attempts', type: 'strength' },
          ],
        },
      },
      narration:
        'Zooming back out, the auth service supports OAuth with Google and GitHub, uses 24-hour JWTs, has no refresh rotation, but does rate-limit login attempts.',
      holdSeconds: 7,
      beats: [{ at: 5.0, action: { type: 'emphasize', target: '2' } }],
    },
    {
      id: 's4a',
      section: 'plainEnglish',
      primitive: {
        template: 'step-journey',
        content: {
          title: 'What a new user actually goes through',
          steps: [
            { icon: '👋', label: 'Lands', detail: 'Marketing site' },
            { icon: '📝', label: 'Signs up', detail: 'Email + password' },
            { icon: '✉️', label: 'Verifies', detail: 'Email link' },
            { icon: '⚙️', label: 'Configures', detail: 'Picks a plan' },
            { icon: '🎉', label: 'First use', detail: 'Creates a project' },
          ],
          staggerMs: 900,
        },
      },
      narration:
        'Zooming all the way out, here is the five-step path a new user walks from landing page to first real use of the app.',
      holdSeconds: 8,
      beats: [{ at: 5.5, action: { type: 'emphasize', target: '4' } }],
    },
    {
      id: 's4b',
      section: 'health',
      primitive: {
        template: 'scorecard',
        content: {
          title: 'Codebase report card',
          overallGrade: 'C+',
          items: [
            { label: 'Architecture', grade: 'B+', note: 'Clean layering, clear seams.' },
            { label: 'Testing', grade: 'F', note: 'No tests at all.' },
            { label: 'Security', grade: 'C-', note: 'JWTs are not signature-verified.' },
            { label: 'Docs', grade: 'B', note: 'README + inline is solid.' },
            { label: 'Performance', grade: 'A-', note: 'Async, cached, indexed.' },
            { label: 'Dependencies', grade: 'C', note: '2 majors behind latest.' },
          ],
        },
      },
      narration:
        'Putting it all together, the report card shows a B-plus architecture, a passing grade on docs and performance, but a failing grade on testing and a C-minus on security.',
      holdSeconds: 8,
      beats: [
        { at: 4.0, action: { type: 'emphasize', target: '1' } },
        { at: 6.0, action: { type: 'emphasize', target: '2' } },
      ],
    },
    {
      id: 's5',
      section: 'health',
      primitive: {
        template: 'emphasis-word',
        content: {
          word: 'FRAGILE',
          subtitle: 'No tests. Unverified tokens. Ship with care.',
          fx: [
            { name: 'slam', duration: 520 },
            { name: 'glow', duration: 1400, strength: 48, color: '#ef4444' },
            { name: 'shake', duration: 400, intensity: 8 },
          ],
          style: { size: 120, weight: '900', color: '#ef4444' },
        },
      },
      narration: 'Overall verdict: fragile. Ship with care until tests and token verification land.',
      holdSeconds: 5,
    },
  ],
};

/**
 * Beat-heavy script — stress-tests beat scheduling and pause/resume.
 */
export const beatHeavyScript: PresentationScript = {
  meta: {
    title: 'Beat stress test',
    repoUrl: 'local://stress',
    generatedAt: new Date().toISOString(),
    persona: 'character',
    estimatedDuration: 20,
  },
  defaults: { palette, transition: defaultTransition, voice },
  scenes: [
    {
      id: 'stress-1',
      section: 'quickFacts',
      primitive: {
        template: 'code-cloud',
        content: {
          items: [
            { text: 'React', weight: 1.0, category: 'framework' },
            { text: 'Express', weight: 0.9, category: 'framework' },
            { text: 'useState', weight: 0.85, category: 'pattern' },
            { text: 'prisma', weight: 0.7, category: 'orm' },
            { text: 'JWT', weight: 0.6, category: 'auth' },
            { text: 'WebSocket', weight: 0.4, category: 'transport' },
            { text: 'Redis', weight: 0.3, category: 'cache' },
          ],
          categoryColors: {
            framework: 'palette.primary',
            pattern: 'palette.secondary',
            orm: 'palette.accent',
            auth: '#f59e0b',
            transport: '#8b5cf6',
            cache: '#ef4444',
          },
          entranceStyle: 'spiral',
        },
      },
      narration:
        'Watch the stack light up — framework, patterns, database, auth, transports, cache. Every corner of the system gets its moment.',
      holdSeconds: 14,
      beats: [
        { at: 2.0, action: { type: 'emphasize', target: 'React' } },
        { at: 4.0, action: { type: 'emphasize', target: 'prisma' } },
        { at: 6.0, action: { type: 'emphasize', target: 'JWT' } },
        { at: 8.0, action: { type: 'emphasize', target: 'WebSocket' } },
        { at: 10.0, action: { type: 'emphasize', target: 'Redis' } },
      ],
    },
    {
      id: 'stress-2',
      section: 'architecture',
      primitive: {
        template: 'transform-grid',
        content: {
          title: 'Request lifecycle',
          stages: [
            {
              label: 'Raw',
              display: { type: 'code', code: 'POST /login', language: 'http' },
            },
            {
              label: 'Validated',
              display: { type: 'code', code: "{ email, pw: '••••' }", language: 'json' },
            },
            {
              label: 'Authenticated',
              display: { type: 'text', text: '✓ match → sign JWT' },
            },
            {
              label: 'Response',
              display: { type: 'code', code: '200 OK', language: 'http' },
            },
          ],
          staggerMs: 600,
          connector: 'arrow',
        },
      },
      narration: 'Four stages, left to right, each one a clean handoff.',
      holdSeconds: 6,
      beats: [
        { at: 1.2, action: { type: 'emphasize', target: '0' } },
        { at: 2.4, action: { type: 'emphasize', target: '1' } },
        { at: 3.6, action: { type: 'emphasize', target: '2' } },
        { at: 4.8, action: { type: 'emphasize', target: '3' } },
      ],
    },
  ],
};

export const sampleScripts = {
  quick: quickScript,
  mixed: mixedScript,
  beatHeavy: beatHeavyScript,
};
