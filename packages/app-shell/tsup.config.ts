import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Only build shared utilities (no JSX)
    'shared/index': 'src/shared/index.ts',
    // Seed system
    'seed/index': 'src/seed/index.ts',
    'seed/cli': 'src/seed/cli.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'solid-js',
    'solid-js/web',
    '@solidjs/router',
    '@coasys/ad4m',
    '@coasys/ad4m-connect',
    'three',
    'gsap',
    /^@we\//, // All @we/* packages
  ],
  outDir: 'dist',
  tsconfig: './tsconfig.json',
});
