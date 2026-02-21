import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        // Required for legacy TypeScript decorators used by @coasys/ad4m
        plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
      },
    }),
  ],
  server: {
    port: 3050,
    host: 'localhost',
  },
});
