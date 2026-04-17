import UserMenu from '../../components/UserMenu';
import HistoryClient from './HistoryClient';

export const metadata = {
  title: 'History — Codesplain',
};

export default function HistoryPage() {
  return (
    <>
      <nav className="nav" aria-label="Primary">
        <a href="/" className="brand" aria-label="Codesplain home">
          <img src="/codesplain_logo.png" alt="Codesplain" />
        </a>
        <UserMenu />
      </nav>
      <main className="auth-shell auth-shell-wide">
        <HistoryClient />
      </main>
    </>
  );
}
