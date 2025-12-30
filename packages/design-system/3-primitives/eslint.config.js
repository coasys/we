import litPlugin from 'eslint-plugin-lit';

import globalConfig from '../../eslint.config.js';

export default [
  ...globalConfig,
  {
    // Add lit plugin for component files
    files: ['components/*.ts'],
    plugins: { lit: litPlugin },
    rules: { ...litPlugin.configs.recommended.rules },
    settings: { lit: { mode: 'typescript' } },
  },
];
