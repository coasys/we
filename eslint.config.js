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
      '**/.storybook/**',
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
    name: 'ad4m-models/declaration-merging',
    files: ['**/models/**/*.ts', '**/src/block-types/**/*.ts'],
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
    files: ['packages/app-framework/**/*.tsx', 'packages/block-system/**/*.tsx', 'packages/schema-system/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...dsPropSelectors()],
    },
  },
];
