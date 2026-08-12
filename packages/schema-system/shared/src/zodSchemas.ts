import { z } from 'zod';

import type { RouteSchema, SchemaNode, SchemaProp, TemplateMeta, TemplateSchema } from './types';

const lazySchemaNode = z.lazy(() => zSchemaNode);
const lazySchemaProp = z.lazy(() => zSchemaProp);
const lazyRouteSchema = z.lazy(() => zRouteSchema);

const zThemeOverrides = z
  .object({
    themeName: z.string().optional(),
    primaryHue: z.number().optional(),
    successHue: z.number().optional(),
    warningHue: z.number().optional(),
    dangerHue: z.number().optional(),
    neutralHue: z.number().optional(),
    saturation: z.string().optional(),
    neutralSaturation: z.string().optional(),
    multiplier: z.number().optional(),
    subtractor: z.string().optional(),
    fontFamily: z.string().optional(),
  })
  .strict();

// --- Token shape Zod schemas ---
// Each matches the corresponding TypeScript type in types.ts.
// Tried before the generic z.record() fallback in zSchemaProp so that
// malformed tokens (e.g. { $if: { wrong: true } }) produce specific errors.

// z.unknown() accepts undefined, which means missing keys pass silently.
// zDefined requires the value to be present (not undefined) while accepting any type.
const zDefined = z.custom<unknown>((v) => v !== undefined, 'Required');

const zStoreToken = z.object({ $store: z.string().min(1) }).strict();
const zConcatToken = z.object({ $concat: z.array(z.unknown()) }).strict();
const zActionToken = z
  .object({
    $action: z.string().min(1),
    args: z.array(z.unknown()).optional(),
    onSuccess: z.array(z.unknown()).optional(),
    onError: z.array(z.unknown()).optional(),
    onFinally: z.array(z.unknown()).optional(),
  })
  .strict();
const zIfToken = z
  .object({
    $if: z.object({
      condition: zDefined,
      then: zDefined,
      else: z.unknown().optional(),
    }),
  })
  .strict();
const zMapToken = z
  .object({
    $map: z.object({
      items: zDefined,
      select: z.record(z.string(), z.unknown()),
    }),
  })
  .strict();
const zPickToken = z
  .object({
    $pick: z.object({
      from: zDefined,
      props: z.array(z.string()),
    }),
  })
  .strict();
const zEqToken = z.object({ $eq: z.array(z.unknown()).length(2) }).strict();
const zNeToken = z.object({ $ne: z.array(z.unknown()).length(2) }).strict();
const zLtToken = z.object({ $lt: z.array(z.unknown()).length(2) }).strict();
const zGtToken = z.object({ $gt: z.array(z.unknown()).length(2) }).strict();
const zInToken = z.object({ $in: z.array(z.unknown()).length(2) }).strict();
const zNotToken = z.object({ $not: zDefined }).strict();
const zAndToken = z.object({ $and: z.array(z.unknown()) }).strict();
const zOrToken = z.object({ $or: z.array(z.unknown()) }).strict();
const zFilterToken = z
  .object({
    $filter: z.object({
      items: zDefined,
      where: z.record(z.string(), z.unknown()),
    }),
  })
  .strict();
const zCountToken = z
  .object({
    $count: z.object({
      items: zDefined,
    }),
  })
  .strict();
/*
  Count-noun labels — `{ $plural: { count, one, other } }`.

  Documented in the schema reference and resolvable since the operator was added, but missing from
  this union until now, so any schema using one failed validation for a pattern that renders fine.
  Nothing caught it because the only fragment emitting one (`peopleRow`'s count) had no validated
  caller — a reminder that this union is a second, hand-maintained list of the operators the
  dispatcher supports, and the two drift silently in exactly this direction.

  `count` is `zDefined` rather than a number: it is nearly always an expression
  (`{ $count: { items } }`), which is the whole reason the operator exists.
*/
const zPluralToken = z
  .object({
    $plural: z.object({
      count: zDefined,
      one: z.string(),
      other: z.string(),
    }),
  })
  .strict();
const zFindToken = z
  .object({
    $find: z.object({
      items: zDefined,
      where: z.record(z.string(), z.unknown()).optional(),
      select: z.string().optional(),
    }),
  })
  .strict();
// Neutral authoring DSL — `entity` (the entity to query) + `dataset` (the perspective/store handle).
// `where`/`order`/`include`/`limit` are the concise DSL; the compiler maps them to the IR. No AD4M
// vocab (`model`/`perspective`) — templates author neutral.
const zQuery = z.object({
  entity: z.string().min(1),
  where: z.record(z.string(), z.unknown()).optional(),
  order: z.record(z.string(), z.unknown()).optional(),
  /*
    A literal, or a token resolving to one.

    Token-valued paging is what makes a "load more" button possible at all: the button raises a
    `$local` number and the query re-runs with a bigger window. The renderer has always supported it
    — `descriptor.params` is deep-resolved before the query is built, exactly like `where` — but the
    schema said `number`, so every paginated list was a validation error for a pattern that worked.
    `scope.anchorId` above already carries the same allowance, and for the same reason.
  */
  limit: z.union([z.number().int().positive(), z.record(z.string(), z.unknown())]).optional(),
  offset: z.union([z.number().int().nonnegative(), z.record(z.string(), z.unknown())]).optional(),
  include: z.record(z.string(), z.unknown()).optional(),
  // Neutral drill-down. `anchorId` may be a token (e.g. '$conversation.id') resolved before the query runs.
  scope: z
    .object({
      via: z.string().min(1),
      anchorId: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]),
      anchor: z.string().optional(),
    })
    .optional(),
  subscribe: z.boolean().optional(),
  dataset: z.string().optional(),
});

const zQueryToken = z.object({ $query: zQuery }).strict();

const zLocalToken = z.object({ $local: z.string().min(1) }).strict();
const zSetLocalToken = z.union([
  z.object({ $setLocal: z.string().min(1), from: z.string().min(1) }).strict(),
  z.object({ $setLocal: z.string().min(1), value: z.unknown() }).strict(),
  z.object({ $setLocal: z.string().min(1), merge: z.record(z.string(), z.unknown()) }).strict(),
  // Add to a number field — the schema layer's only arithmetic. See `resolveSetLocalProp`.
  z.object({ $setLocal: z.string().min(1), by: z.number() }).strict(),
]);
const zErrorToken = z.object({ $error: z.string().min(1) }).strict();
const zValidToken = z.object({ $valid: z.string().min(1) }).strict();
const zTouchedToken = z.object({ $touched: z.string().min(1) }).strict();
const zFormValidToken = z.object({ $formValid: z.string().min(1) }).strict();
const zTouchToken = z.object({ $touch: z.string().min(1) }).strict();
const zResetLocalToken = z.object({ $resetLocal: z.string().min(1) }).strict();
const zToggleLocalToken = z.object({ $toggleLocal: z.string().min(1) }).strict();
const zCallLocalToken = z.object({ $callLocal: z.string().min(1) }).strict();

// --- Validation rule Zod schemas ---
const zRequiredRule = z.object({ rule: z.literal('required'), message: z.string().optional() }).strict();
const zMinLengthRule = z
  .object({ rule: z.literal('minLength'), value: z.number().int().positive(), message: z.string().optional() })
  .strict();
const zMaxLengthRule = z
  .object({ rule: z.literal('maxLength'), value: z.number().int().positive(), message: z.string().optional() })
  .strict();
const zMinRule = z.object({ rule: z.literal('min'), value: z.number(), message: z.string().optional() }).strict();
const zMaxRule = z.object({ rule: z.literal('max'), value: z.number(), message: z.string().optional() }).strict();
const zPatternRule = z
  .object({ rule: z.literal('pattern'), value: z.string().min(1), message: z.string().optional() })
  .strict();
const zMatchRule = z
  .object({ rule: z.literal('match'), field: z.string().min(1), message: z.string().optional() })
  .strict();
const zValidationRule = z.union([
  zRequiredRule,
  zMinLengthRule,
  zMaxLengthRule,
  zMinRule,
  zMaxRule,
  zPatternRule,
  zMatchRule,
]);

/** All prop-level token types — used in both prop values and children arrays */
const zPropToken = z.union([
  zStoreToken,
  zConcatToken,
  zActionToken,
  zIfToken,
  zMapToken,
  zPickToken,
  zEqToken,
  zNeToken,
  zLtToken,
  zGtToken,
  zInToken,
  zNotToken,
  zAndToken,
  zOrToken,
  zQueryToken,
  zLocalToken,
  zSetLocalToken,
  zErrorToken,
  zValidToken,
  zTouchedToken,
  zFormValidToken,
  zTouchToken,
  zResetLocalToken,
  zToggleLocalToken,
  zCallLocalToken,
  zFilterToken,
  zCountToken,
  zFindToken,
  zPluralToken,
]);

const zLocalStateField = z.object({
  type: z.enum(['string', 'boolean', 'number', 'file', 'function', 'object']),
  initial: z.union([z.string(), z.boolean(), z.number(), z.null(), zPropToken]),
  validate: z.array(zValidationRule).optional(),
  persist: z.string().optional(),
  syncParam: z.union([z.string(), z.object({ name: z.string(), push: z.boolean().optional() })]).optional(),
});
const zLocalStateDeclaration = z.record(z.string(), zLocalStateField);

const zQueryStateField = zQuery; // $queries entries use the same neutral query grammar
const zQueriesDeclaration = z.record(z.string(), zQueryStateField);

/** Known node-level operator types */
export const NODE_OPERATORS = new Set(['$each', '$if', '$routes']);

function schemaNodeShape() {
  return {
    id: z.string().optional(),
    type: z.string().optional(),
    props: z.record(z.string(), lazySchemaProp).optional(),
    slots: z.record(z.string(), lazySchemaNode).optional(),
    slot: z.string().optional(),
    routes: z.array(lazyRouteSchema).optional(),
    children: z.array(z.union([lazySchemaNode, z.string(), zPropToken])).optional(),
    theme: zThemeOverrides.optional(),
    styles: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    $localState: zLocalStateDeclaration.optional(),
    $queries: zQueriesDeclaration.optional(),
  };
}

export const zSchemaNode: z.ZodType<SchemaNode> = z
  .object(schemaNodeShape())
  .strict()
  .superRefine((node, ctx) => {
    if (node.type === '$each') {
      if (!node.props?.items)
        ctx.addIssue({ code: 'custom', path: ['props', 'items'], message: '$each requires an "items" prop' });
      if (!node.children?.length)
        ctx.addIssue({
          code: 'custom',
          path: ['children'],
          message: '$each requires at least one child as item template',
        });
    }
    if (node.type === '$if') {
      if (!node.props?.condition)
        ctx.addIssue({ code: 'custom', path: ['props', 'condition'], message: '$if requires a "condition" prop' });
      if (!node.props?.then)
        ctx.addIssue({ code: 'custom', path: ['props', 'then'], message: '$if requires a "then" prop' });
    }
    // Note: $routes is a render slot — it marks where routed content appears.
    // The actual routes array lives on the parent template or route node, not on the $routes node itself.
  });

export const zSchemaProp: z.ZodType<SchemaProp> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  // Token objects — tried before the generic record fallback
  zPropToken,
  // Nested schema nodes (e.g. $if.then / $if.else containing a node with $localState).
  // Must come before the plain-record fallback because the fallback rejects objects
  // that have any $-prefixed key, which would incorrectly reject nodes with $localState.
  lazySchemaNode,
  // Fallback: plain objects/arrays that aren't tokens or schema nodes.
  // Rejects objects with $-prefixed keys at the parse level (not via superRefine)
  // so that the union properly rejects malformed tokens.
  z.custom<Record<string, unknown>>(
    (val) =>
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val) &&
      !Object.keys(val).some((k) => k.startsWith('$')),
  ),
  z.array(lazySchemaProp),
  z.undefined(),
]);

export const zTemplateMeta: z.ZodType<TemplateMeta> = z
  .object({
    name: z.string(),
    description: z.string(),
    icon: z.string(),
    stores: z
      .union([
        z.array(z.string()),
        z.record(
          z.string(),
          z.union([
            z.literal(true),
            z.object({
              actions: z.array(z.string()).optional(),
              state: z.array(z.string()).optional(),
            }),
          ]),
        ),
      ])
      .optional(),
    components: z.array(z.string()).optional(),
  })
  .strict();

export const zTemplateSchema: z.ZodType<TemplateSchema> = z
  .object({
    ...schemaNodeShape(),
    author: z.string().optional(),
    templateVersion: z.number().optional(),
    schemaVersion: z.number().optional(),
    meta: zTemplateMeta,
    _fromSpace: z.boolean().optional(),
  })
  .strict();

export const zRouteSchema: z.ZodType<RouteSchema> = z
  .object({
    ...schemaNodeShape(),
    path: z.string(),
    redirect: z.string().optional(),
    keepAlive: z.boolean().optional(),
  })
  .strict();
