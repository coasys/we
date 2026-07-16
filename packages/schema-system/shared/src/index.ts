export type {
  ComponentRegistry,
  RenderProps,
  RendererOutput,
  SchemaNode,
  SchemaProp,
  TemplateMeta,
  TemplateSchema,
  ThemeOverrides,
  RouteSchema,
  TransitionConfig,
  TransitionEffect,
  StoreToken,
  ConcatToken,
  ActionToken,
  IfToken,
  MapToken,
  PickToken,
  EqToken,
  NeToken,
  LtToken,
  GtToken,
  NotToken,
  AndToken,
  OrToken,
  QueryToken,
  QueryDescriptor,
  OperatorToken,
  LocalStateField,
  QueryStateField,
  LocalToken,
  SetLocalToken,
  ErrorToken,
  ValidToken,
  TouchedToken,
  FormValidToken,
  TouchToken,
  ResetLocalToken,
  ToggleLocalToken,
  ValidationRule,
  RequiredRule,
  MinLengthRule,
  MaxLengthRule,
  MinRule,
  MaxRule,
  PatternRule,
  MatchRule,
} from './types';

export type {
  ContextData,
  ContextFragment,
  PrimitiveEntry,
  ComponentEntry,
  PropEntry,
  ModelEntry,
  ModelFieldEntry,
  ModelRelationEntry,
  StoreEntry,
  StateMemberMeta,
  TokenCategory,
} from './contextTypes';

export { validateSchema, validateSemantic, buildValidationContext } from './semanticValidation';
export type { ValidationContext } from './semanticValidation';
export { validateStructure } from './validators';
export type { ValidationError, ValidationResult } from './validators';
export { NODE_OPERATORS } from './zodSchemas';
export { findMutations, isLengthMutation } from './mutations';
export { resolveProp, resolveProps, resolveQueryProp, splitProps, REACTIVE_ACCESSOR } from './propResolvers';
export type { LocalFieldMeta, LocalMetaMap, MapProp } from './propResolvers';
export { hasToken } from './predicates';
export { themeToStyle } from './themeStyles';
export { validateField } from './validation';
export {
  computeSectionIndex,
  extractByPath,
  patchByPath,
  validatePatches,
  ensureSections,
  ensureNodeIds,
  stripNodeIds,
  findNodeById,
  mergeNode,
  insertChild,
  removeChild,
} from './indexer';
export type { SectionEntry, StoredTemplate, FindNodeResult, PatchError } from './indexer';
export { createStoredTemplate, listSections, getSection, updateSection } from './sections';
export { getComponentMeta } from './componentMeta';
export type { ComponentMeta, PropMeta, PropLayer } from './componentMeta';
export type {
  DatasetHandle,
  QueryOptions,
  QuerySubscription,
  ModelClass,
  MutationApi,
  DataSource,
  RendererDataBindings,
} from './dataSource';
export { modelManifestSchema, validateManifest, getEntity, getProperty, getRelation } from './manifest';
export type {
  ModelManifest,
  EntitySchema,
  PropertySchema,
  RelationSchema,
  ScalarType,
  Cardinality,
  ManifestError,
} from './manifest';
export { queryIRSchema, filterSchema, validateQueryIR } from './queryIR';
export { validateQueryAgainstManifest } from './queryValidation';
export { planQuery } from './queryCapabilities';
export type { AdapterCapabilities, AggregateFn, Disposition, CapabilityGap, QueryPlan } from './queryCapabilities';
export { translateLegacyQuery } from './legacyQuery';
export type { LegacyQuery, LegacyTranslation } from './legacyQuery';
export type {
  QueryIR,
  Filter,
  Op,
  Scalar,
  SortKey,
  Page,
  IncludeSpec,
  IncludeMap,
  Aggregation,
  IRError,
} from './queryIR';
