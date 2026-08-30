import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';

import prettierConfig from './.prettierrc.json' with { type: 'json' };

/**
 * CSS properties (in both camelCase and kebab-case spellings) that have a design-system
 * prop of the same meaning. Sourced from the DS prop layers in
 * `packages/design-system/utils/src/index.ts`.
 *
 * Properties with no DS equivalent — white-space, filter, clip-path, backdrop-filter,
 * mix-blend-mode, grid-template-*, object-fit — are deliberately absent: `styles` is the
 * correct tool for those.
 */
const DS_PROP_EQUIVALENTS = [
  'width',
  'height',
  'minWidth',
  'min-width',
  'maxWidth',
  'max-width',
  'minHeight',
  'min-height',
  'maxHeight',
  'max-height',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'z-index',
  'display',
  'overflow',
  'overflowX',
  'overflow-x',
  'overflowY',
  'overflow-y',
  'flex',
  'alignSelf',
  'align-self',
  'margin',
  'marginTop',
  'margin-top',
  'marginRight',
  'margin-right',
  'marginBottom',
  'margin-bottom',
  'marginLeft',
  'margin-left',
  'padding',
  'paddingTop',
  'padding-top',
  'paddingRight',
  'padding-right',
  'paddingBottom',
  'padding-bottom',
  'paddingLeft',
  'padding-left',
  'gap',
  'background',
  'backgroundColor',
  'background-color',
  'color',
  'opacity',
  'border',
  'borderColor',
  'border-color',
  'borderRadius',
  'border-radius',
  'boxShadow',
  'box-shadow',
  'cursor',
  'pointerEvents',
  'pointer-events',
  'transform',
  'transition',
  'fontSize',
  'font-size',
  'fontWeight',
  'font-weight',
  'lineHeight',
  'line-height',
  'letterSpacing',
  'letter-spacing',
  'textAlign',
  'text-align',
  'textDecoration',
  'text-decoration',
  'textTransform',
  'text-transform',
  'fontFamily',
  'font-family',
  'flexDirection',
  'flex-direction',
  'flexShrink',
  'flex-shrink',
  'whiteSpace',
  'white-space',
  'alignItems',
  'align-items',
  'justifyContent',
  'justify-content',
];

/** Elements that accept DS props: `we-*` primitives and the layout/composite components. */
const DS_ELEMENTS = '^(we-|Column$|Row$|Grid$|Card$)';

function dsPropSelectors() {
  const props = `^(${DS_PROP_EQUIVALENTS.join('|')})$`;
  const message =
    'This CSS property has a design-system prop — use it instead of the style/styles escape hatch ' +
    '(e.g. width="130px", maxHeight="250px"). Reserve styles for CSS with no DS equivalent.';
  // Object keys appear as identifiers (width) or string literals ('max-height').
  return ['key.name', 'key.value'].map((keyPath) => ({
    selector:
      `JSXOpeningElement[name.name=/${DS_ELEMENTS}/] > JSXAttribute[name.name=/^styles?$/] ` +
      `> JSXExpressionContainer > ObjectExpression > Property[${keyPath}=/${props}/]`,
    message,
  }));
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/build/**',
      '**/old/**',
      '**/target/**',
      '**/dist-electron/**',
      // Machine-generated sources (e.g. packages/entities/src/generated/coreManifest.ts,
      // written by generateCoreManifest.mjs) — emitted JSON-style, not prettier-style.
      '**/src/generated/**',
      // Same, from we-seed.json via apps/we-electron/scripts/generate-seed-config.cjs. The
      // generator's output has never been prettier-clean; the copy in the tree was hand-fixed once
      // and stayed that way only because nothing regenerated it in the root build.
      'apps/we-electron/electron/seed-*',
      // The branch-aware ad4m build (scripts/build-with-ad4m-link.sh) and
      // its CI counterpart clone the matching ad4m branch into ./ad4m and
      // link it via pnpm.overrides.  ESLint must not walk into that
      // checkout — it's not WE source, and walking it OOMs the linter.
      'ad4m/**',
    ],
  },
  {
    name: 'common/recommended',
    plugins: { prettier: prettierPlugin },
    rules: { ...prettierPlugin.configs.recommended.rules, 'prettier/prettier': ['error', prettierConfig] },
  },
  {
    name: 'javascript/recommended',
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        // Global in Node since 10 and in Electron's main process; it was simply missing.
        URL: 'readonly',
        URLSearchParams: 'readonly',
        module: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: { 'simple-import-sort': simpleImportSortPlugin },
    rules: {
      ...js.configs.recommended.rules,
      'simple-import-sort/imports': 'error',
    },
  },
  {
    name: 'typescript/recommended',
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin, 'simple-import-sort': simpleImportSortPlugin },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'simple-import-sort/imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      // A leading underscore is the codebase's existing signal for "deliberately unused" —
      // destructuring a key purely to keep it out of a `...rest` spread, or a positional
      // parameter that exists only to reach a later one.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Turn off any rules that conflict with prettier
  eslintConfigPrettier,
  {
    // Declaration merging (interface + class) is the approved pattern for
    // adding HasManyMethods types to Ad4mModel subclasses without triggering
    // Babel's declare-field ordering issues. The interface body is intentionally
    // empty — it inherits all members from HasManyMethods<Keys>.
    name: 'ad4m-entities/declaration-merging',
    files: ['**/backend-system/ad4m/src/entities/**/*.ts', '**/src/block-types/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Design-system props over the style/styles escape hatch.
    //
    // CLAUDE.md ("Using the Design System in TypeScript Components") says to use `styles`
    // only for CSS with no DS equivalent — but that only held while people remembered it,
    // and the editor panels drifted a long way. This makes the common half mechanical:
    // if a CSS property has a DS prop of the same meaning, writing it through style/styles
    // is an error.
    //
    // Scoped deliberately:
    //   - only elements that accept DS props (we-* primitives, Column/Row/Grid/Card).
    //     A raw <div style> has no DS prop to use instead, so it is out of scope.
    //   - only DS-consuming packages. @we/components and @we/widgets *implement* DS props
    //     and legitimately write raw CSS; the React playgrounds have no DS at all.
    name: 'design-system/prefer-ds-props',
    files: [
      'packages/app-shell/**/*.tsx',
      'packages/editor/**/*.tsx',
      'packages/block-system/**/*.tsx',
      'packages/schema-system/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...dsPropSelectors()],
    },
  },
  {
    /*
      `console.log` is a debugging statement that got committed.

      Twenty of them sat in library source across three audits, saying things like
      "DatasetStore: creating root dataset" to whoever happened to have devtools open — noise in a
      shipped app, and the reason a genuine warning is hard to see in it.

      Three are allowed, and the line is about audience rather than severity. `error` and `warn`
      report a problem — this codebase reports a swallowed failure through `console.error` beside a
      toast, and several docblocks name that as the contract. `info` is the deliberate, low-volume
      operational note: "this runtime does not report pass progress", "recovered after 3 failed
      sends" — things worth saying once to whoever is looking at a misbehaving deployment.

      `log` and `debug` are what a debugging session leaves behind. Twenty of them said
      "DatasetStore: creating root dataset" to anybody who happened to open devtools, which is the
      noise a real warning has to be found in.

      Scoped to library source. A CLI's whole output is `console.log` (`seed/cli.ts`, the context
      generator, the schema validator), a test may print, and a playground is not shipped.
    */
    name: 'we/no-console-log-in-library-source',
    files: ['packages/**/src/**/*.ts', 'packages/**/src/**/*.tsx'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/src/cli/**',
      '**/cli/src/**',
      '**/app-shell/src/seed/cli.ts',
      // A component whose entire purpose is to print when it re-renders.
      '**/RerenderLog/**',
      '**/ai-context/src/**',
      // Its entire purpose is a console line, opt-in and off by default.
      '**/installConsoleTrace.ts',
    ],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
];
