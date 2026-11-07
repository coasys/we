import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The window's stylesheet is read as text by its tests (`identity.css?raw`): left out, vitest
    // hands every stylesheet over empty.
    css: { include: [/identity\.css/] },
  },
});
