import LoginForm from './LoginForm';

export const metadata = {
  title: 'Sign in — Codesplain',
};

export default function LoginPage() {
  return (
    <>
      <nav className="nav" aria-label="Primary">
        <a href="/" className="brand" aria-label="Codesplain home">
          <img src="/codesplain_logo.png" alt="Codesplain" />
        </a>
      </nav>
      <main className="auth-shell">
        <LoginForm />
      </main>
    </>
  );
}
