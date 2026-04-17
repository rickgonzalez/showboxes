//apps/server/app/page.tsx
import HeroPlayerSlot from './components/HeroPlayerSlot';
import InlineLottie from './components/InlineLottie';
import UserMenu from './components/UserMenu';

const PLAYER_URL = process.env.NEXT_PUBLIC_PLAYER_URL ?? 'http://localhost:5173';

export default function Home() {
  return (
    <>
      <nav className="nav" aria-label="Primary">
        <a href="/" className="brand" aria-label="Codesplain home">
          <img src="/codesplain_logo.png" alt="Codesplain" />
        </a>
        <div className="nav-links" role="navigation">
          <a href="#how">How it works</a>
          <a href="#what">What you get</a>
          <a href="#pricing">Pricing</a>
          <a href={PLAYER_URL}>Player</a>
        </div>
        <UserMenu />
      </nav>

      {/* ---------- HERO ---------- */}
      <header className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Now in preview · built on Claude</span>
            <h1>
              Watch any codebase <span className="accent">explain</span>{' '}
              <span className="accent-light">itself.</span>
            </h1>
            <p className="lead">
              Drop in a GitHub URL. Codesplain reads the repo, picks what matters, and
              hands back an animated walkthrough narrated, paced, and scored for
              whichever human you need to bring along.
            </p>
            <div className="cta-row">
              <a href={PLAYER_URL} className="btn-primary">Generate a walkthrough</a>
              <a href="#how" className="btn-ghost">See how it works</a>
            </div>
          </div>

          <div className="hero-visual">
            <HeroPlayerSlot />
          </div>
        </div>
      </header>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="section">
        <div className="container">
          <div className="kicker">Three acts</div>
          <h2>Quiet on set. We point two agents at your repo and roll.</h2>
          <p style={{ maxWidth: 640, color: 'var(--ink-soft)', fontSize: 17, lineHeight: 1.6 }}>
            Codesplain splits the work the way a film crew would. A fast scout reads
            the shape of the project. You pick the story. A second agent writes the
            scenes. Then a player performs it.
          </p>

          <div className="steps">
            <div className="step">
              <div className="art">
                <InlineLottie src="/animations/step-triage.json" fallbackColor="#1d7ab7" label="Scout animation" />
              </div>
              <div className="number">01</div>
              <h3>Scout the repo</h3>
              <p>A cheap Haiku pass reads only the tree and manifests. It comes back with the major subsystems, entry points, and what looks load-bearing.</p>
            </div>

            <div className="step">
              <div className="art">
                <InlineLottie src="/animations/step-analyze.json" fallbackColor="#6fc4eb" label="Analyze animation" />
              </div>
              <div className="number">02</div>
              <h3>Choose the angle</h3>
              <p>Overview, focused-brief, scorecard, or walkthrough. Pick a lens and a depth. Only the parts you care about get read deeply.</p>
            </div>

            <div className="step">
              <div className="art">
                <InlineLottie src="/animations/step-present.json" fallbackColor="#1d7ab7" label="Presentation animation" />
              </div>
              <div className="number">03</div>
              <h3>Watch it play</h3>
              <p>A director agent writes scene-by-scene. The player renders code, diagrams, and motion — with narration tuned to your audience.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- WHAT YOU GET ---------- */}
      <section id="what" className="section">
        <div className="container">
          <div className="wyg">
            <div style={{ aspectRatio: '1 / 1', maxWidth: 380, margin: '0 auto' }}>
              <InlineLottie
                src="/animations/what-you-get.json"
                fallbackColor="#1d7ab7"
                label="Animated illustration of a presentation being assembled"
              />
            </div>
            <div>
              <div className="kicker">What you get</div>
              <h2>A narrated walkthrough, not a pile of notes.</h2>
              <ul>
                <li><span className="dot" /> A paced, narrated presentation with real code on screen, highlighted line-by-line where it matters.</li>
                <li><span className="dot" /> Four personas — corporate, character, friendly, stern — so the same analysis can brief an exec or onboard a junior.</li>
                <li><span className="dot" /> Re-render on demand. Change audience, pace, or persona without re-reading the repo.</li>
                <li><span className="dot" /> An auditable analysis JSON underneath, ready to feed your own docs, slides, or RAG.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- PRICING TEASER ---------- */}
      <section id="pricing" className="section">
        <div className="container">
          <div className="pricing-teaser">
            <div>
              <div className="kicker">Credits, not subscriptions</div>
              <h2>Pay only for the runs that land.</h2>
              <p style={{ color: 'var(--ink-soft)', fontSize: 17, lineHeight: 1.6, maxWidth: 520 }}>
                Buy a bundle of Credits. Each operation: triage, analysis, script,
                voice has a transparent per-credit cost. If a run errors out, you
                don't get charged. New accounts start with a free-tier grant so your
                first walkthrough is on us.
              </p>
              <div className="cta-row" style={{ marginTop: 24 }}>
                <a href="/api/credits/pricing" className="btn-ghost">See full pricing</a>
              </div>
            </div>

            <div className="price-card">
              <span className="badge">Most popular</span>
              <div className="amount">$22<small> / 2,500 credits</small></div>
              <p>
                About 25 focused-brief analyses, or 60+ script re-renders. Use across
                repos; credits don't expire.
              </p>
              <a href={PLAYER_URL} className="btn-primary" style={{ display: 'inline-block' }}>
                Start building
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer>
        <div className="container row">
          <div>© {new Date().getFullYear()} Horizon Two Labs · codesplain.io</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <a href="/api/credits/pricing">Pricing</a>
            <a href={PLAYER_URL}>Player</a>
            <a href="https://docs.anthropic.com">Built on Claude</a>
          </div>
        </div>
      </footer>
    </>
  );
}
