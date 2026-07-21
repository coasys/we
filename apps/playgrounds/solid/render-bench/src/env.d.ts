/// <reference types="vite/client" />

// Side-effect CSS imports have no type declarations. The design tokens ship a raw CSS bundle at the
// `@we/tokens/css` subpath (not a `*.css` specifier, so vite/client's ambient doesn't match it).
declare module '@we/tokens/css';
declare module '*.css';
