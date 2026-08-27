import type { SchemaNode } from '@we/schema-shared';

/**
 * Anything that can sit in a node's `children`: a literal string, another node, or an operator
 * token that resolves to text (`$store`, `$concat`, `$if`, `$plural`, …).
 *
 * Named here because most of this kit's options are "a label, or an expression producing one", and
 * `unknown` would push the cast onto every fragment while `string` would refuse the expressions
 * that make the fragments worth having.
 */
export type Content = NonNullable<SchemaNode['children']>[number];

/**
 * What can identify the anchor of a `scope` drill-down: a literal id, or an expression
 * (`{ $: 'channel.id' }`, `{ $: 'routeStore.segments[1]' }`).
 *
 * Narrower than `SchemaProp` on purpose, and matching `QueryStateField`'s own `scope.anchorId`
 * exactly. An anchor is one record's id, so the members `SchemaProp` adds — a boolean, an array —
 * are not values it can ever legitimately take, and accepting them would move the error from the
 * fragment's call site to a query the backend rejects at runtime.
 */
export type AnchorId = string | number | Record<string, unknown>;
