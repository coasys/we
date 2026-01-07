// Design system styles (must be imported before components)
import '@we/tokens/css';
import '@we/themes';
import '@we/primitives/solid';
import '@we/components/styles';
import '@we/widgets/styles';
import '@we/pages/styles';
import '@we/templates/styles';

// App
export { default as App } from './App';

// Platform abstraction
export * from '../../shared/platform';

// Components
export { default as AiInterface } from './components/AiInterface';
export { default as AppSettings } from './components/AppSettings';
export { default as Splashscreen } from './components/Splashscreen';

// Stores
export * from './stores';

// Providers
export { default as StoreProvider } from './providers/StoreProvider';
export { default as TemplateProvider } from './providers/TemplateProvider';

// Registries
export * from './registries/componentRegistry';
export * from '../../shared/registries/templateRegistry';
export * from '../../shared/registries/themeRegistry';

// Schemas
export * from '../../shared/schemas';

// Types
export * from './types';

// Utils
export * from '../../shared/utils';
