import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Allow `after()` for fire-and-forget work — kicked off agent session
    // polling continues past the response.
    // Next 15 has `after` stable; no experimental flag needed. Kept for
    // documentation.
  },
  // CORS for the player's dev server on 5173/5174. Production is same-origin.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
