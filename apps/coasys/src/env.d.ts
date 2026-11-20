/// <reference types="vite/client" />

/*
  The shell's ambient declarations reach this program through `include` in this app's tsconfig, as in
  apps/we-web (see its env.d.ts for why that is configuration rather than a reference here).
*/

/** The endpoints of the build's `COASYS_ENV`, defined by `vite.config.ts` (see apps/we-web's env.d.ts). */
declare const __APP_ENDPOINTS__: unknown;
