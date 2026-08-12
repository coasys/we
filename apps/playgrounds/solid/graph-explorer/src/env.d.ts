/// <reference types="vite/client" />

declare module '@we/tokens/css';
// Same story as tokens/css: the export resolves to a CSS file, but the bare
// specifier doesn't end in .css, so neither vite/client nor the *.css ambient
// matches it.
declare module '@we/graph-solid/styles';
declare module '*.css';
declare module '@we/themes';
