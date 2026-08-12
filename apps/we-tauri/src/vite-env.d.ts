/**
 * The shell imports a `.glb` for its 3D cube; Vite resolves asset imports to a URL string at build
 * time and `vite/client` does not declare this extension. Repeated per host because an ambient
 * declaration only applies to the program that includes it, and each host compiles the shell under
 * its own tsconfig.
 */
declare module '*.glb' {
  const src: string;
  export default src;
}
