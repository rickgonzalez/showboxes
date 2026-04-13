export const metadata = {
  title: 'showboxes server',
  description: 'Agent orchestration for the showboxes player.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>{children}</body>
    </html>
  );
}
