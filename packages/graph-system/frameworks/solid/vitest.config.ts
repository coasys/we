import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  // The component this package exports is JSX, so the test run needs the same compiler the build uses
  // — without it a plain `.ts` test importing from a `.tsx` module fails to parse.
  plugins: [solidPlugin()],
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  test: { environment: 'happy-dom' },
});
