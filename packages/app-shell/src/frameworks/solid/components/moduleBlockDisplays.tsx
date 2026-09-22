/**
 * How a module's content type is drawn — its declared card, rendered wherever a block of it appears.
 *
 * ## The half of a block a module cannot ship as code
 *
 * A block type is a model plus a display plus an input. A module declares the model (`entities`) and
 * names a part as the card (`blocks[].card`); the input, where it has one, is a framework component
 * it contributes. What was missing was anything that turned the named part into the display the
 * block renderer calls — the renderer takes a component, and a part is a `SchemaNode`.
 *
 * This is that: one Solid component per module block type, each rendering the card part with the
 * block's fields bound as `block`, handed to `BlockDisplayOverrides` so the renderer finds it where
 * it looks for a display. Against the **chrome bag**, since the card is module-authored — the same
 * rule that renders a module's panel against chrome and a template's panel body against the
 * template's own bag.
 *
 * ## What it does not do
 *
 * Composer editing. A block with no `input` component renders everywhere and is inserted through the
 * record form rather than typed in place — the honest limit of a declaration, which the marketplace
 * plan already names.
 */
import { moduleBlockNodeType, moduleRegistry } from '@shared/registries/moduleRegistry';
import { chromeBag } from '@shared/registries/templateBag';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { Component } from 'solid-js';
import { createMemo } from 'solid-js';

/** The card part, drawn over one block's fields. */
function declaredCard(part: SchemaNode): Component<Record<string, unknown>> {
  return (props) => {
    const body = createMemo(() => {
      const bag = chromeBag();
      if (!bag) return null;
      // `$each` over a one-item literal list is how a fragment written against `block.<field>` is
      // handed the record — the same binding a template's own card gets from a query.
      const node: SchemaNode = {
        type: '$each',
        props: { items: [{ ...props }], as: 'block' },
        children: [part],
      };
      return RenderSchema({ node, stores: bag, registry });
    });
    return <>{body()}</>;
  };
}

/**
 * Display components for every module block type, keyed by node type — what `BlockDisplayOverrides`
 * takes. Rebuilt when asked; modules register at boot, so the map is stable for a session.
 */
export function moduleBlockDisplays(): Record<string, Component<Record<string, unknown>>> {
  const out: Record<string, Component<Record<string, unknown>>> = {};
  const parts = moduleRegistry.parts();
  for (const block of moduleRegistry.blocks()) {
    const part = parts[`${block.moduleId}.${block.card}`];
    if (!part) continue;
    out[moduleBlockNodeType(block)] = declaredCard(part.node);
  }
  return out;
}
