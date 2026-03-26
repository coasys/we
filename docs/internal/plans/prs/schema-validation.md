# Plan: Extend Schema Validation (Structural → Semantic)

> Upgrade the existing Zod-based schema validation from "is this valid JSON shape?" to "will this schema actually render?"

---

## Context

Schema validation already exists in `packages/schema-system/shared/src/`:

- **`zodSchemas.ts`** — Zod schemas for `SchemaNode`, `TemplateSchema`, `TemplateMeta`, `RouteSchema`
- **`validators.ts`** — `validateSchema()` and `validateNode()` returning `{ valid: boolean, errors: ValidationError[] }`
- **`types.ts`** — typed token definitions (`IfToken`, `MapToken`, etc.)
- Called from `schemaUpdater.ts` on schema updates

**What it catches today:** Missing `meta`, wrong field types, extra keys (`.strict()`), structural nesting issues.

**What it misses:** Whether the schema will actually work at render time — unknown component types, wrong props for a component, malformed operator tokens, references to non-existent stores.

This is the AI feedback loop gap. AI generates a schema → `validateSchema()` says "valid" → renderer throws `Schema node has unknown type "Stackk"` at runtime.

**Prerequisite:** None — can land independently. However, shares a source of truth with [ai-context-package](ai-context-package.md) (both need component metadata). Designed so ai-context can provide the metadata, but works standalone with a simple registry.

---

## Design

### Principle: accept metadata as a parameter

The validator doesn't know what components exist — that depends on the app's registry. Rather than coupling to a specific registry, the extended validation accepts metadata:

```typescript
type ComponentMeta = {
  props?: Record<string, PropMeta>;
  slots?: string[];
  description?: string;
};

type PropMeta = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function';
  required?: boolean;
  enum?: string[]; // e.g. display: 'list' | 'grid'
};

type ValidationContext = {
  components?: Record<string, ComponentMeta>; // known component types + their props
  stores?: string[]; // known store names for $store validation
};
```

When `ValidationContext` is provided, the validator checks semantics. When omitted, it falls back to today's structural-only validation — fully backwards compatible.

Later, `@we/ai-context`'s `assembleContext()` can produce the `ValidationContext` directly from extracted source data.

### Severity levels

Extend `ValidationError` with a severity:

```typescript
type ValidationError = {
  path: string;
  message: string;
  severity: 'error' | 'warning';
};
```

- **error** — will break at render time (unknown component, missing required prop, malformed operator)
- **warning** — suspicious but won't crash (unknown prop name, unused store reference)

Existing consumers that check just `valid` are unaffected. `valid` remains `false` only when there are errors (not warnings).

---

## Implementation

All changes in `packages/schema-system/shared/src/`. No new packages.

### 1. Token shape Zod schemas (`zodSchemas.ts`)

The TypeScript types in `types.ts` already define operator shapes. Add matching Zod schemas that validate them:

```typescript
// Discriminated token schemas
const zStoreToken = z.object({ $store: z.string().min(1) }).strict();
const zExprToken = z.object({ $expr: z.string().min(1) }).strict();
const zActionToken = z.object({ $action: z.string().min(1), args: z.array(z.unknown()).optional() }).strict();
const zIfToken = z
  .object({
    $if: z.object({
      condition: z.unknown(),
      then: z.unknown(),
      else: z.unknown().optional(),
    }),
  })
  .strict();
const zMapToken = z
  .object({
    $map: z.object({
      items: z.unknown(),
      select: z.record(z.string(), z.unknown()),
    }),
  })
  .strict();
const zPickToken = z
  .object({
    $pick: z.object({
      from: z.unknown(),
      props: z.array(z.string()),
    }),
  })
  .strict();
const zEqToken = z.object({ $eq: z.tuple([z.unknown(), z.unknown()]) }).strict();
const zNeToken = z.object({ $ne: z.tuple([z.unknown(), z.unknown()]) }).strict();
const zNotToken = z.object({ $not: z.unknown() }).strict();
const zAndToken = z.object({ $and: z.array(z.unknown()) }).strict();
const zOrToken = z.object({ $or: z.array(z.unknown()) }).strict();
```

Refine `zSchemaProp` to check token shapes when a `$`-prefixed key is detected:

```typescript
export const zSchemaProp: z.ZodType<SchemaProp> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  // Token objects — tried as discriminated union first
  zStoreToken,
  zExprToken,
  zActionToken,
  zIfToken,
  zMapToken,
  zPickToken,
  zEqToken,
  zNeToken,
  zNotToken,
  zAndToken,
  zOrToken,
  // Fallback: plain objects/arrays that aren't tokens
  z.record(z.string(), z.unknown()),
  z.array(lazySchemaProp),
  z.undefined(),
]);
```

Token shape errors now surface through existing Zod validation — `{ "$if": { "wrong": true } }` fails with a path like `props.visible.$if.condition: Required`.

**Note:** Zod union ordering matters. Token schemas go before the generic `z.record()` fallback so they're tried first. If a `$`-keyed object doesn't match any token schema, it falls through to the record — use a `.superRefine()` to catch unrecognised `$` keys and emit a warning.

### 2. Node-level operator validation (`zodSchemas.ts`)

`$forEach`, `$if`, and `$routes` are node-level operators (they appear as `type`, not in `props`). Add validation for their required props:

```typescript
// In schemaNodeShape(), add superRefine:
zSchemaNode = z
  .object(schemaNodeShape())
  .strict()
  .superRefine((node, ctx) => {
    if (node.type === '$forEach') {
      if (!node.props?.items)
        ctx.addIssue({ code: 'custom', path: ['props', 'items'], message: '$forEach requires an "items" prop' });
      if (!node.children?.length)
        ctx.addIssue({
          code: 'custom',
          path: ['children'],
          message: '$forEach requires at least one child as item template',
        });
    }
    if (node.type === '$if') {
      if (!node.props?.condition)
        ctx.addIssue({ code: 'custom', path: ['props', 'condition'], message: '$if requires a "condition" prop' });
      if (!node.props?.then)
        ctx.addIssue({ code: 'custom', path: ['props', 'then'], message: '$if requires a "then" prop' });
    }
    if (node.type === '$routes') {
      if (!node.routes?.length)
        ctx.addIssue({ code: 'custom', path: ['routes'], message: '$routes requires at least one route' });
    }
  });
```

### 3. Semantic validation pass (`validators.ts`)

After Zod structural validation passes, run a semantic walk when `ValidationContext` is provided:

```typescript
export function validateSchema(schema: unknown, context?: ValidationContext): ValidationResult {
  // Phase 1: structural (existing Zod)
  const structural = validateStructural(schema);
  if (!structural.valid) return structural;

  // Phase 2: semantic (new, only if context provided)
  if (context) {
    const semantic = validateSemantic(schema as TemplateSchema, context);
    return {
      valid: semantic.errors.filter((e) => e.severity === 'error').length === 0,
      errors: [...semantic.errors],
    };
  }

  return structural;
}
```

The semantic walker recurses through the schema tree checking:

| Check                     | Severity | Condition                                                                                                                    |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unknown component type    | error    | `node.type` not in `context.components` and not a known operator (`$if`, `$forEach`, `$routes`) and not a known HTML element |
| Unknown prop              | warning  | `propName` not in `context.components[type].props`                                                                           |
| Wrong prop type           | warning  | prop value doesn't match `PropMeta.type` (after resolving tokens)                                                            |
| Missing required prop     | error    | `PropMeta.required` but prop absent                                                                                          |
| Invalid enum value        | warning  | static string value not in `PropMeta.enum`                                                                                   |
| Unknown store reference   | warning  | `$store` path root not in `context.stores`                                                                                   |
| `$store` without dot path | error    | `$store: "storeName"` with no property path (already caught at runtime)                                                      |

**Note:** Props containing tokens (`$store`, `$expr`, etc.) skip type/enum checks — their resolved values can't be known statically.

### 4. Export + backwards compatibility

```typescript
// validators.ts — maintain existing signature as overload
export function validateSchema(schema: unknown): ValidationResult;
export function validateSchema(schema: unknown, context: ValidationContext): ValidationResult;
export function validateSchema(schema: unknown, context?: ValidationContext): ValidationResult {
  // ...
}
```

Existing callers (`schemaUpdater.ts`) continue to call `validateSchema(schema)` with no changes. New callers (AI editing flow, MCP tool) pass `context` for deeper checking.

### 5. Tests

Tests live alongside existing schema-system tests:

- **Token shape tests** — each operator type with valid/invalid shapes
- **Node-level operator tests** — `$forEach` missing items, `$if` missing condition
- **Semantic tests** — unknown component, unknown prop, missing required prop, unknown store
- **Backwards compatibility** — existing tests pass unchanged without `ValidationContext`
- **Mixed severity** — schema with warnings but no errors → `valid: true`

---

### 6. Schema version validation

Add `schemaVersion` to the `TemplateMeta` Zod schema as an optional semver string:

```typescript
const zTemplateMeta = z.object({
  name: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
  schemaVersion: z
    .string()
    .regex(/^\d+\.\d+$/)
    .optional(), // e.g. "1.0"
  forkedFrom: z.string().nullable().optional(),
});
```

When `schemaVersion` is present, the semantic walker can emit warnings for tokens that don't exist in that version (e.g. a `"1.0"` schema using `$validate` → warning: `$validate requires schemaVersion >= 1.1`). The version-to-token mapping is a simple lookup table maintained alongside the token tier list.

---

## What this does NOT cover

- **JSON Schema for IDE autocomplete** — not worth a dedicated effort; if AI generates 90%+ of schemas, the programmatic validator is the primary gate. Can auto-generate from the same metadata later if needed.
- **Component prop metadata extraction** — that's [ai-context-package](ai-context-package.md)'s job. This PR accepts metadata, it doesn't produce it.
- **`$query` / `$localState` validation** — added when those tokens are implemented.
- **Cross-node validation** — e.g. "slot name matches parent's slot definition." Deferred until it causes real problems.

---

## Sizing

Small-medium PR. The heavy lifting (Zod setup, error formatting, tree walking) already exists. New work:

- ~50 lines: token Zod schemas (mechanical from existing types)
- ~30 lines: node-level operator refinements
- ~100 lines: semantic walker
- ~20 lines: types + export changes
- ~200 lines: tests

Total: ~420 lines, nearly all in `packages/schema-system/shared/src/`.

---

## Relationship to other plans

| Plan                                        | Relationship                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [ai-context-package](ai-context-package.md) | Produces `ValidationContext` from extracted source data. `assembleContext()` output feeds directly into `validateSchema(schema, context)` |
| [mcp-tools](mcp-tools.md)                   | `validate_schema` MCP tool calls this function. The tool is a thin wrapper around `validateSchema()`                                      |
| Ecosystem `$query` / `$localState`          | When new tokens land, add their Zod schemas to the token union and node-level checks                                                      |
