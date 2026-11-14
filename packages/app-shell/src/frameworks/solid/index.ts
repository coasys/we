// Design system styles (must be imported before components)
import '@we/tokens/css';
// The hosted webfonts are an opt-in separate file so the token variables stay offline-safe.
import '@we/tokens/css/fonts';
import '@we/primitives/solid';
import '@we/components/styles';
import '@we/widgets/styles';
import '@we/block-solid/styles';

// App
export { default as App } from './App';

// Platform abstraction — the contracts are framework-neutral, the provider is Solid's
export * from '../../shared/platform';
export * from './providers/PlatformProvider';
export type { WeSeedFile } from '../../types/seed';

// Stores
export * from './stores';

// Providers
export { default as StoreProvider } from './providers/StoreProvider';
export { default as TemplateProvider } from './providers/TemplateProvider';

// Registries
export * from './registries/componentRegistry';
export * from '../../shared/registries/templateRegistry';
export * from '../../shared/registries/viewRegistry';
export * from '../../shared/registries/themeRegistry';
/*
  Only the publication function, not the whole dock registry — a host paints fixed chrome (the
  connect button's corner bar) and needs somewhere to say so, while the rest of the registry is
  the shell's own machinery. Named rather than `export *` so nothing internal leaks.
*/
export { registerHostChromeReserve } from '../../shared/registries/dockRegistry';

// Schemas
export * from '../../shared/schemas';

// Types
export * from './types';

// Utils
export * from '../../shared/utils';
