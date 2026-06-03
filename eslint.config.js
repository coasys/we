import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';

import prettierConfig from './.prettierrc.json' with { type: 'json' };

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
];
