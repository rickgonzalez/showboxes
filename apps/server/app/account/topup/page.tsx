import UserMenu from '../../components/UserMenu';
import TopupClient from './TopupClient';

export const metadata = {
  title: 'Top up — Codesplain',
};

export default function TopupPage() {
  return (
    <>
      <nav className="nav" aria-label="Primary">
        <a href="/" className="brand" aria-label="Codesplain home">
          <img src="/codesplain_logo.png" alt="Codesplain" />
        </a>
        <UserMenu />
      </nav>
      <main className="auth-shell auth-shell-wide">
        <TopupClient />
      </main>
    </>
  );
}
