import litPlugin from 'eslint-plugin-lit';

import globalConfig from '../../../eslint.config.js';

export default [
  ...globalConfig,
  {
    // Add lit plugin for the Lit custom-element sources
    files: ['src/primitives/**/*.ts'],
    plugins: { lit: litPlugin },
    rules: { ...litPlugin.configs.recommended.rules },
    settings: { lit: { mode: 'typescript' } },
  },
];
