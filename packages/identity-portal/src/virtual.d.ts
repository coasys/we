/** The app's theme, built into a stylesheet by `vite.js` (`identityThemeCss`). */
declare module 'virtual:we-identity-theme.css';
/** The app's name and mark, or `null` where its app brings none (`identityBrand` in `vite.js`). */
declare module 'virtual:we-identity-brand' {
  const brand: { name: string; mark: string | null } | null;
  export default brand;
}
/** The tokens, a stylesheet in `@we/tokens`' dist. */
declare module '@we/tokens/css';
