/**
 * What runs on `git commit`, against the staged files only.
 *
 * Scoped deliberately narrowly. The point is to catch the class of failure that was costing
 * a full CI round trip — a formatting slip, an unused import, a lint rule — not to
 * re-run the pipeline locally. Typecheck is not here on purpose: `tsc` has no meaningful
 * per-file mode in a project this size (63s across the workspace), so it would turn every
 * commit into a minute of waiting, which is how hooks end up being bypassed with `--no-verify`
 * and then removed.
 *
 * `--max-warnings 0` matches what CI enforces, so the hook and the pipeline agree about what
 * "clean" means. `--no-warn-ignored` keeps a staged file that ESLint's config ignores (the
 * generated sources, the seed files) from failing the commit merely for being passed in.
 */
export default {
  '*.{ts,tsx,js,jsx,mjs,cjs}': 'eslint --fix --max-warnings 0 --no-warn-ignored',

  // ESLint carries prettier for the files above; these it does not lint at all.
  '*.{json,md,yaml,yml,html}': 'prettier --write',

  // Stylelint 16's standard config holds no stylistic rules, so it and prettier are not
  // fighting over the same properties. Note this is a wider net than `pnpm lint:css`, which
  // only walks the src directories — a stray stylesheet elsewhere gets fixed here and is
  // unchecked in CI.
  '*.css': ['stylelint --fix', 'prettier --write'],
};
