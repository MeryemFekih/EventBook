import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: `npm run dev` in client/ (http://localhost:5173), proxies /api to the
// Express backend on :3000. Prod: `npm run build` outputs into ../public,
// which server.js serves statically — so `npm start` at the repo root serves
// the whole app from a single port (3000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
