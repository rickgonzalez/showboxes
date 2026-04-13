export default function Home() {
  return (
    <main>
      <h1>showboxes server</h1>
      <p>
        Agent orchestration for the{' '}
        <a href="http://localhost:5173">showboxes player</a>.
      </p>
      <ul>
        <li>
          <code>POST /api/analyze</code> → kick off Agent 1
        </li>
        <li>
          <code>GET /api/analyze/[id]</code> → poll status, fetch result
        </li>
        <li>
          <code>POST /api/script</code> → Agent 2, Messages API
        </li>
      </ul>
    </main>
  );
}
