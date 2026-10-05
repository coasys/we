import type { Plugin } from 'vite';

import type { Host } from './index';

export function contentSecurityPolicy(options: { host: Exclude<Host, 'electron'>; seedFile: string }): Plugin;
export function rewriteKnockoutGlobalEval(): Plugin;
