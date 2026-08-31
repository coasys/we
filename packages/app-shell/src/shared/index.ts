// Platform abstraction
export * from './platform';

// Data-layer connection contract
export * from './backend';

// Registries
export * from './registries/templateRegistry';
export * from './registries/viewRegistry';
export * from './registries/themeRegistry';

// Schemas
export * from './schemas';

// Integration system
export * from './integrationComposer';
export * from './initializeIntegrations';

// Module registration — lets deployments add their own modules before boot.
export { bundledModules, type BundledModuleFactory } from './registries/bundledModules';

// Utils
export * from './utils';

// Prompts
// schemaContext is now provided by @we/ai-context
