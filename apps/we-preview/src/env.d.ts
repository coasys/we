/// <reference types="vite/client" />

/*
  The shell's own ambient declarations reach this program through `include` in this app's tsconfig, which
  names `packages/app-shell/src/shared/global.d.ts` directly.

  Every host here compiles the shell's source under its own tsconfig, and an ambient declaration only
  applies to the program that includes it — so each host used to carry its own copy of the shell's `*.glb`
  block, with a comment in each apologising for the duplication. Naming the file in `include` gives one
  list instead, and anything added to it arrives here for nothing. A triple-slash reference would do the
  same job and is what `triple-slash-reference` forbids, which is why this is configuration rather than
  a line of code.
*/
