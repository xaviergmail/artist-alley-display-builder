import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages hosts project sites below /<repository>/; local development
  // and ordinary production builds continue to use the domain root.
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    host: true,
    allowedHosts: true,
  },
});
