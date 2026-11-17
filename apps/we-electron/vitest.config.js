import { defineConfig } from 'vitest/config';

/*
  One file at a time. The `main.*.test.js` files each drive `main.js` against a fake executor, and
  `main.js` picks the executor's port with `findFreePort` from one range: two files running at once
  probe the same free port, one fake cannot bind it and exits 80, and that file's scenario gains a
  start it did not plan. The suite takes a few seconds either way.
*/
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
