import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        // Required for legacy TypeScript decorators used by @coasys/ad4m.
        // class-properties must run after decorators (legacy mode requirement).
        plugins: [
          ['@babel/plugin-proposal-decorators', { legacy: true }],
          ['@babel/plugin-proposal-class-properties', { loose: true }],
        ],
      },
    }),
  ],
  server: {
    port: 3050,
    host: 'localhost',
  },
});
