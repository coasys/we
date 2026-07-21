/**
 * Component registries for the benchmark fixtures.
 *
 * `we-*` primitives are custom elements — they render as tag strings once `@we/primitives` is
 * imported for its side effects, so they need no entry here. Only PascalCase `@we/components` do.
 */
import { Column, Row } from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import type { JSX } from 'solid-js';

export const registry: ComponentRegistry = { Column, Row };

/**
 * Isolates the schema walk from the design system: `Column`/`Row` become trivial pass-through divs,
 * so what remains is the renderer's own cost.
 *
 * Note this does NOT stub `we-*` — hyphenated types mount as real custom elements regardless of the
 * registry, so any fixture containing them still pays full Lit cost here. Only fixtures built from
 * `Column`/`Row` alone give a clean renderer-only reading. The browser ladder is the better
 * decomposition; this exists for fast headless before/after checks on renderer changes.
 */
const Passthrough = (props: { children?: JSX.Element }) => <div>{props.children}</div>;

export const stubRegistry: ComponentRegistry = { Column: Passthrough, Row: Passthrough };
