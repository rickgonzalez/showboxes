import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Vite on :5173 proxies all auth/API traffic to Next on :3001 so
// the browser sees everything as same-origin. The cs_session cookie
// (SameSite=Lax, HttpOnly) rides along on every /api/* call the way it
// will in production. Keep VITE_SERVER_URL unset in dev so the helpers
// in pipeline/api.ts build relative URLs that hit this proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
      '/login': { target: 'http://localhost:3001', changeOrigin: false },
      '/_next': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
});
