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

// Schemas
export * from '../../shared/schemas';

// Types
export * from './types';

// Utils
export * from '../../shared/utils';
