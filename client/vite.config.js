import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    target: 'esnext', // Better WASM support
  },
  publicDir: 'public',
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'], // Exclude from dependency optimization
  },
});
