/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devApi } from './server/dev-api.ts';
import { licenses } from './scripts/licenses.mjs';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), devApi(), licenses()],
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  build: {
    // livekit-client is one library of about 530 kB that cannot be split further; it loads on the
    // first connect, after the window has painted. Anything else past 560 kB still warns.
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      // The app, and the kit gallery that shows its parts.
      input: { main: 'index.html', gallery: 'gallery.html' },
      output: {
        // The SDK loads on the first connect; its WebRTC stack is a chunk of its own.
        codeSplitting: { groups: [{ name: 'livekit', test: /node_modules[\\/].*livekit-client/ }] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    // The kit's token checks read stylesheets as text; without this Vitest hands them over empty.
    css: true,
  },
});
