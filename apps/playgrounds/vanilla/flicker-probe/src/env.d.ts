/// <reference types="vite/client" />

/*
  The CSS-only specifiers this probe imports for their side effects.

  Both resolve to a `.css` file through their package's export map, but the bare specifier does not end in
  `.css`, so neither `vite/client` nor the `*.css` ambient below matches it. TypeScript 5 let a side-effect
  import of an unresolvable module pass in silence; TypeScript 6 reports it (TS2882), which is how this
  gap came to light. `graph-explorer/src/env.d.ts` has said the same thing for longer.
*/
declare module '@we/tokens/css';
declare module '@we/themes';
declare module '*.css';
