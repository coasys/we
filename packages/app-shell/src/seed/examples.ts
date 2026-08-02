import type { WeSeedFile } from '../types/seed';

/**
 * Example seed file for Flux app (single app)
 */
export const fluxSeedExample: WeSeedFile = {
  project: {
    name: 'Flux',
    version: '1.0.0',
    description: 'Social communication platform built on AD4M',
    author: 'Flux Team',
    repository: 'https://github.com/fluxapp/flux',
    license: 'MIT',
  },

  host: {
    theme: {
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
      },
    },
  },

  ad4m: {
    ai: {
      enabled: true,
      config: {
        model: 'gpt-4',
      },
    },
    perspectives: [
      {
        name: 'Flux Channels',
      },
    ],
    languages: [
      {
        name: 'flux-message-language',
      },
    ],
  },

  apps: [
    {
      id: 'flux',
      name: 'Flux',
      icon: 'camera',
      capabilities: ['perspectives', 'languages', 'agents'],
      commands: {
        install: 'pnpm install',
        build: 'pnpm build',
        dev: 'pnpm dev',
      },
      paths: {
        projectRoot: './',
        dist: 'dist',
        devServer: {
          port: 5173,
          host: 'localhost',
        },
      },
    },
  ],
};

/**
 * Example seed file for a community app
 */
export const communityAppExample: WeSeedFile = {
  project: {
    name: 'Community Hub',
    version: '0.1.0',
    description: 'Decentralized community management platform',
    author: 'Community Team',
    license: 'Apache-2.0',
  },

  apps: [
    {
      id: 'community',
      name: 'Community Hub',
      icon: 'users',
      capabilities: ['perspectives', 'agents'],
      commands: {
        install: 'npm install',
        build: 'npm run build',
      },
      paths: {
        projectRoot: './',
        dist: 'build',
        devServer: {
          port: 3000,
        },
      },
    },
  ],
};

/**
 * Minimal seed file example
 */
export const minimalExample: WeSeedFile = {
  project: {
    name: 'My App',
    version: '1.0.0',
    description: 'A simple integrated app',
    author: 'Developer',
  },

  apps: [
    {
      id: 'myapp',
      name: 'My App',
      icon: 'app-window',
      capabilities: [],
      commands: {
        install: 'pnpm install',
        build: 'pnpm build',
      },
      paths: {
        projectRoot: './',
        dist: 'dist',
      },
    },
  ],
};
