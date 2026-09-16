import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadConfig } from '../../packages/gateway/src/config.ts';

export default defineConfig(({ command }) => {
  const { cm, token, tokenSource } = loadConfig();

  // The host page calls the CM directly, like Cloud Portal, so it needs the
  // token. Only the dev server gets it: a `vite build` must never bake a real
  // Sitecore Cloud token into static files.
  const devToken = command === 'serve' ? token : null;
  if (command === 'serve') {
    console.log(`  CM      ${cm}`);
    console.log(`  token   ${token ? `yes (${tokenSource})` : 'NONE - authenticated calls will 401'}`);
  }

  return {
    plugins: [react()],
    define: {
      __SML_CM__: JSON.stringify(cm),
      __SML_CM_TOKEN__: JSON.stringify(devToken),
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
