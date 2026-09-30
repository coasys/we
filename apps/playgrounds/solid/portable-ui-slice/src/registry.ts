/**
 * Component registry — the design-system components this harness's template uses.
 *
 * `we-*` primitives are custom elements (they render as tag strings once `@we/primitives` is
 * imported for its side effects — see main.tsx), so they need NO registry entry. Only PascalCase
 * `@we/components` are registered here.
 */
import { Card, Column, Row } from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';

export const registry: ComponentRegistry = { Column, Row, Card };
