import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The gateway runs as a separate Node process. Proxying it through Vite
      // keeps the browser on a single origin, so `host.request` forwarding is
      // not subject to CORS.
      '/__gateway': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__gateway/, ''),
      },
    },
  },
});
