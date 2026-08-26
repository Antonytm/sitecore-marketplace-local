import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Every extension point route (/standalone, /fullscreen, ...) serves the same
  // page; the probe reads which one it is from application.context.
  appType: 'spa',
  server: { port: 3001, strictPort: true },
});
