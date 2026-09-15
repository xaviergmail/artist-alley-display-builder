import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages hosts project sites below /<repository>/; local development
  // and ordinary production builds continue to use the domain root.
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    host: true,
    allowedHosts: true,
  },
  build: {
    // Ship three.js (~600KB core) as its own cached vendor chunk so app-code
    // changes don't invalidate it and the entry chunk stays small.
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
