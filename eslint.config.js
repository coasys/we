import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';

import prettierConfig from './.prettierrc.json' with { type: 'json' };

export default [
  {
    name: 'common/recommended',
    plugins: { prettier: prettierPlugin },
    rules: { ...prettierPlugin.configs.recommended.rules, 'prettier/prettier': ['error', prettierConfig] },
    ignores: ['**/dist/**', '**/node_modules/**', '**/build/**', '**/old/**'],
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
      },
    },
    plugins: { 'simple-import-sort': simpleImportSortPlugin },
    rules: {
      ...js.configs.recommended.rules,
      'simple-import-sort/imports': 'error',
    },
    ignores: ['**/dist/**', '**/node_modules/**', '**/build/**', '**/old/**'],
  },
  {
    name: 'typescript/recommended',
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin, 'simple-import-sort': simpleImportSortPlugin },
    languageOptions: { parser: tsParser, parserOptions: { project: './tsconfig.json' } },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'simple-import-sort/imports': 'error',
    },
    ignores: ['**/dist/**', '**/node_modules/**', '**/build/**', '**/old/**'],
  },
  // Turn off any rules that conflict with prettier
  eslintConfigPrettier,
];
