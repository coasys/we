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
