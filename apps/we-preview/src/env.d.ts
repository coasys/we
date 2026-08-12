/// <reference types="vite/client" />

/**
 * The shell imports a `.glb` for its 3D cube. Vite resolves asset imports to a URL string at build
 * time; `vite/client` declares the common extensions but not this one, so a host that actually
 * typechecks the shell's source has to say so itself.
 *
 * we-web needs this too and does not have it — it has no `typecheck` script, so nothing ever asked.
 */
declare module '*.glb' {
  const src: string;
  export default src;
}
