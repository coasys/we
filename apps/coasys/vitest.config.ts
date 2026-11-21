import path from 'path';
import { defineConfig } from 'vitest/config';

/*
  The hosts' tests: plain modules over fakes, in node. The build's own config (`vite.config.ts`) is
  not used, because it writes the seed's registries and copies the globe's assets, and nothing here
  renders. The phone's connector reads the seed for its app's name, so the seed this app is built
  for is the one it gets here too.
*/
export default defineConfig({
  resolve: {
    alias: { '@we/seed-file': path.resolve(import.meta.dirname, '../../seeds/coasys.seed.json') },
  },
  test: {
    name: 'coasys',
    include: ['src/**/*.test.ts'],
  },
});
