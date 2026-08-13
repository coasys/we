/// <reference types="vite/client" />

/**
 * The shell imports a `.glb` for its 3D cube, and Vite resolves asset imports to a URL string at
 * build time. `vite/client` declares the common extensions but not this one, so a host that
 * typechecks the shell's source has to say so itself.
 *
 * The same block appears in we-preview and we-electron. It belongs with the asset, but an ambient
 * declaration only applies to the program that includes it, and each host compiles the shell under
 * its own tsconfig.
 */
declare module '*.glb' {
  const src: string;
  export default src;
}
