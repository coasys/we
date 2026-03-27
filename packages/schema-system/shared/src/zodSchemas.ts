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
    uiHue: z.number().optional(),
    saturation: z.string().optional(),
    uiSaturation: z.string().optional(),
    multiplier: z.number().optional(),
    subtractor: z.string().optional(),
    fontFamily: z.string().optional(),
  })
  .strict();

function schemaNodeShape() {
  return {
    type: z.string().optional(),
    props: z.record(z.string(), lazySchemaProp).optional(),
    slots: z.record(z.string(), lazySchemaNode).optional(),
    slot: z.string().optional(),
    routes: z.array(lazyRouteSchema).optional(),
    children: z.array(z.union([lazySchemaNode, z.string()])).optional(),
    theme: zThemeOverrides.optional(),
  };
}

export const zSchemaNode: z.ZodType<SchemaNode> = z.object(schemaNodeShape()).strict();

export const zSchemaProp: z.ZodType<SchemaProp> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(lazySchemaProp),
  z.undefined(),
]);

export const zTemplateMeta: z.ZodType<TemplateMeta> = z
  .object({
    name: z.string(),
    description: z.string(),
    icon: z.string(),
  })
  .strict();

export const zTemplateSchema: z.ZodType<TemplateSchema> = z
  .object({
    ...schemaNodeShape(),
    id: z.string().optional(),
    schemaVersion: z.number().optional(),
    meta: zTemplateMeta,
  })
  .strict();

export const zRouteSchema: z.ZodType<RouteSchema> = z.object({ ...schemaNodeShape(), path: z.string() }).strict();
