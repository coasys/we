/**
 * The contents of a panel an interface supplied, rendered with the interface's own grants.
 *
 * The frame around it is chrome — its grip, snap menu and reset name `host-layout` members no
 * template may have — and its body is the template's. Two authors in one tree, so two bags: the
 * frame goes through the chrome bag with everything else in the slot registry, and this switches to
 * the template's for the node inside. See `shared/registries/templateBag.ts` for why that matters.
 *
 * It takes the panel's **id** rather than its node. A node passed as a prop would go through the
 * prop resolver on its way in, which is a walk over somebody else's tree looking for tokens to
 * resolve — and it would freeze the declaration at the moment the frame was registered, where a
 * template being edited re-declares on every keystroke. The id is stable; the declaration is looked
 * up when it renders.
 */
import { templateBag } from '@shared/registries/templateBag';
import { onTemplatePanelsChanged, templatePanels } from '@shared/registries/templatePanels';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { createMemo, createSignal, onCleanup } from 'solid-js';

export function TemplatePanelBody(props: { panelId?: string; moduleId?: string }) {
  // The declaration is a plain array behind a change channel, so a signal is what makes reading it
  // reactive — the same shape `ShellStore` uses to follow the same registry.
  const [version, setVersion] = createSignal(0);
  onCleanup(onTemplatePanelsChanged(() => setVersion((v) => v + 1)));

  /*
    By panel id for a panel the interface supplied outright, by module id for one where it supplied
    the *contents* of a module's panel. Two ways in because the two are addressed differently: the
    first has a frame of its own, the second is inside the module's.
  */
  const node = createMemo(() => {
    version();
    const panel = templatePanels().find((entry) =>
      props.moduleId ? entry.module === props.moduleId && entry.node : entry.id === props.panelId,
    );
    return panel?.node as SchemaNode | undefined;
  });

  /*
    A memo rather than a `Show` with a callback: `RenderSchema` is called as a function here — as it
    is everywhere else in this package — and what it returns is the renderer's own output rather
    than a JSX element, which `Show`'s children signature will not take.
  */
  const body = createMemo(() => {
    const declared = node();
    const bag = templateBag();
    if (!declared || !bag) return null;
    return RenderSchema({ node: declared, stores: bag, registry });
  });

  return <>{body()}</>;
}

export default TemplatePanelBody;
