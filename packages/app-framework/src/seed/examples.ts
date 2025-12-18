import type { WeSeedFile } from '../types/seed';

/**
 * Example seed file for Flux app
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

  paths: {
    projectRoot: './',
    dist: 'dist',
    devServer: {
      port: 5173,
      host: 'localhost',
    },
  },

  commands: {
    install: 'yarn install',
    build: 'yarn build',
    dev: 'yarn dev',
    clean: 'yarn clean',
  },

  ui: {
    theme: {
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
      },
    },
    routes: [
      {
        path: '/flux',
        component: 'FluxMain',
      },
      {
        path: '/flux/chat/:channelId',
        component: 'FluxChat',
      },
    ],
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

  integration: {
    mount: 'flux',
    capabilities: ['perspectives', 'languages', 'agents'],
    platforms: ['electron', 'tauri', 'web'],
    entry: 'index.html',
  },
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

  paths: {
    projectRoot: './',
    dist: 'build',
    devServer: {
      port: 3000,
    },
  },

  commands: {
    install: 'pnpm install',
    build: 'pnpm build',
    dev: 'pnpm dev',
  },

  integration: {
    mount: 'community',
    capabilities: ['perspectives', 'agents'],
    platforms: ['web'],
  },
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

  paths: {
    projectRoot: './',
    dist: 'dist',
  },

  commands: {
    install: 'pnpm install',
    build: 'pnpm build',
    dev: 'pnpm dev',
  },

  integration: {
    mount: 'myapp',
    capabilities: [],
    platforms: ['web'],
  },
};
