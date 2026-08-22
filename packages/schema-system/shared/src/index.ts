export type {
  ComponentRegistry,
  RenderProps,
  RendererOutput,
  SchemaNode,
  SchemaProp,
  TemplateMeta,
  TemplateSchema,
  RouteParamsBinding,
  ThemeOverrides,
  ThemeRole,
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
  PluginCatalog,
  PluginEntry,
} from './contextTypes';

export { validateSchema, validateSemantic, buildValidationContext } from './semanticValidation';
export type { ValidationContext } from './semanticValidation';
export { validateStructure } from './validators';
export type { ValidationError, ValidationResult } from './validators';
export { NODE_OPERATORS } from './zodSchemas';
export { findMutations, isLengthMutation } from './mutations';
export {
  resolveProp,
  resolveProps,
  pruneUnresolvedWhere,
  resolveQueryProp,
  splitProps,
  markReactive,
  REACTIVE_ACCESSOR,
  deepUnwrap,
  noMemo,
  setLocalWarningSink,
} from './propResolvers';
export type { LocalFieldMeta, LocalMetaMap, MapProp } from './propResolvers';
export { hasToken } from './predicates';
export { isPropsSchemaNode, isSchemaChild, replaceNodeInTree } from './treeUtils';
export {
  applyThemeVars,
  DARK_SURFACES,
  migrateOverrides,
  parseOverrides,
  reconcileSurfaces,
  roleVar,
  surfacesForPolarity,
  THEME_SCHEMA_VERSION,
  themeToStyle,
} from './themeStyles';
export { validateField } from './validation';
export {
  computeSectionIndex,
  extractByPath,
  patchByPath,
  validatePatches,
  ensureSections,
  collectComponentTypes,
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
export { contextData } from './generated/contextData';
export type { ComponentMeta, PropMeta, PropLayer } from './componentMeta';
export { findNodeChain, findScopeRef, getScopeAtNode, inferRefKind, scopeRefToToken } from './scope';
export type { ScopeGroup, ScopeOptions, ScopeRef, ScopeRefKind, ScopeValueType } from './scope';
export {
  classifyContent,
  contentAsText,
  emptyComparison,
  isBlankComparison,
  isUnaryOperator,
  MAX_CONDITION_DEPTH,
  parseCondition,
  parseValue,
  parseValueIf,
  serializeCondition,
  serializeValue,
  serializeValueIf,
  UNARY_OPERATORS,
} from './conditionModel';
export type {
  ComparisonOperator,
  ConditionComparison,
  ConditionExpr,
  ConditionGroup,
  ConditionOperand,
  ContentShape,
  FormStateToken,
  ValueIf,
} from './conditionModel';
