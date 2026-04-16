import './globals.css';

export const metadata = {
  title: 'Codesplain — watch your codebase explain itself',
  description:
    'Point Codesplain at a GitHub repo. Get back a bright, animated walkthrough that explains the architecture to anyone — code-curious or career-engineer.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: 'light', backgroundColor: '#e9f2fb' }}>
      <head>
        {/* Single sans-serif family — Inter for everything. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
