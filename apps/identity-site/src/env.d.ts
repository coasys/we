/// <reference types="vite/client" />
// The portal's window module imports these; the portal's own Vite plugins provide them at build time.
declare module '@we/tokens/css';
declare module 'virtual:we-identity-brand' {
  const brand: { name: string; mark: string | null } | null;
  export default brand;
}
declare module 'virtual:we-identity-theme.css';
