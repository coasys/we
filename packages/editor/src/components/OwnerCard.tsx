/**
 * What the inspector says about a region somebody else provides — a part the template placed, a
 * panel a module draws, a section — and the routes to taking it over.
 *
 * A region that is owned elsewhere is not a fault in the template, and the worst thing it can do is
 * sit there inert with nothing said. Selected, it names its owner and offers what can be done, the
 * cheapest first:
 *
 * 1. **Restyle it.** Colour, spacing and shape are the theme's, and a theme reaches a module's panel
 *    and a section like anything else. Nothing is taken over, so nothing stops being updated.
 * 2. **Arrange its pieces** (a panel) or **open it** (a part). The arrangement becomes the template's
 *    and the pieces stay the module's, so a fix to one still lands in it.
 * 3. **Make it your own.** A copy of all of it, which no longer receives the owner's changes. Said
 *    in so many words, because that is the cost and it is easy not to notice.
 * 4. **Replace** or **remove** it.
 *
 * Every route that writes the template goes through one path, which records an undo step and saves
 * the edit the way the inspector's own edits are saved. A built-in template is read-only, so those
 * routes are offered as what a fork would allow rather than as buttons that do nothing.
 */
import { Column, Row } from '@we/components/solid';
import { SECTION_LABEL_PROPS } from '@we/schema-kit';
import {
  copyWithNewIds,
  ensureNodeIds,
  findNodeById,
  type SchemaNode,
  type TemplatePanel,
  type TemplateSchema,
} from '@we/schema-shared';
import { type OwnerRef, useVisualEditor } from '@we/schema-solid';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { type OwnedPart, useEditorHost } from '../host';
import { deepClone } from '../utils';

/** One route out of an owned region: what it does, what it costs, and the button. */
function Route(props: { title: string; detail: string; action: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Column gap="100" py="200">
      <Row ax="between" ay="center" gap="300">
        <we-text variant="label">{props.title}</we-text>
        <we-button size="xs" variant="secondary" disabled={props.disabled} onClick={props.onPress}>
          {props.action}
        </we-button>
      </Row>
      <we-text variant="footnote" color="text-muted">
        {props.detail}
      </we-text>
    </Column>
  );
}

function Heading(props: { icon: string; title: string; subtitle: string; children?: JSX.Element }) {
  return (
    <Column gap="200" px="400" pt="300">
      <Row ay="center" gap="200">
        <we-icon name={props.icon} size="sm" color="text-muted" />
        <we-text variant="subheading">{props.title}</we-text>
      </Row>
      <we-text variant="footnote" color="text-muted">
        {props.subtitle}
      </we-text>
      {props.children}
    </Column>
  );
}

/** The template-writing half every route shares. */
function useTemplateWriter() {
  const host = useEditorHost();
  return (mutate: (template: SchemaNode) => boolean) => {
    const clone = deepClone(host.template.currentTemplate) as SchemaNode;
    if (!mutate(clone)) return false;
    host.session.pushSnapshot();
    host.template.updateTemplate(clone as TemplateSchema);
    void host.session.commitEdit();
    return true;
  };
}

/** Said instead of the routes that write, on a template that cannot be saved in place. */
function ReadOnlyNote() {
  const session = useEditorHost().session;
  return (
    <Row ax="between" ay="center" gap="300" py="200">
      <we-text variant="footnote" color="text-muted">
        This template is built in. Fork it to arrange, open or replace what is here.
      </we-text>
      <we-button size="xs" variant="ghost" onClick={() => session.startFork()}>
        Fork
      </we-button>
    </Row>
  );
}

// -----------------------------------------------------------------------
// A part the template placed
// -----------------------------------------------------------------------

export function PartCard(props: { node: SchemaNode }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();

  const partId = () => ((props.node.props ?? {}) as { id?: string }).id ?? '';
  const info = createMemo<OwnedPart | null>(() => host.owners?.part(partId()) ?? null);
  const readOnly = () => host.session.isReadOnly();

  /** Whether opening one level keeps anything the module's — only if the part is built of parts. */
  const nested = createMemo(() => JSON.stringify(host.owners?.openPart(props.node, 'one') ?? null).includes('"$part"'));

  const takeOver = (depth: 'one' | 'all') => {
    let replacement: SchemaNode | undefined;
    write((template) => {
      const found = findNodeById(template, props.node.id ?? '');
      const opened = found && host.owners?.openPart(found.node, depth);
      if (!found || !opened) return false;
      replacement = copyWithNewIds(opened);
      replacement.forkedFrom = `part:${partId()}`;
      // In place, so the parent — whatever position it holds the part in — holds the replacement.
      for (const key of Object.keys(found.node)) delete (found.node as Record<string, unknown>)[key];
      Object.assign(found.node, replacement);
      return true;
    });
    if (replacement?.id) visualEditor.onSelect(replacement.id);
  };

  const remove = () => {
    const removed = write((template) => {
      const found = findNodeById(template, props.node.id ?? '');
      if (!found?.parent || found.key !== 'children' || !found.parent.children) return false;
      found.parent.children.splice(found.index, 1);
      return true;
    });
    if (removed) visualEditor.onSelect(null);
  };

  /** What a placement gives the part for one of the names it needs, as the expression typed. */
  const inputValue = (name: string) => {
    const value = ((props.node.props ?? {}) as { inputs?: Record<string, { $?: string }> }).inputs?.[name];
    return typeof value?.$ === 'string' ? value.$ : '';
  };

  const setInput = (name: string, expression: string) => {
    write((template) => {
      const found = findNodeById(template, props.node.id ?? '');
      if (!found) return false;
      const nodeProps = (found.node.props ??= {}) as Record<string, unknown>;
      const inputs = { ...((nodeProps.inputs as Record<string, unknown> | undefined) ?? {}) };
      if (expression.trim()) inputs[name] = { $: expression.trim() };
      else delete inputs[name];
      if (Object.keys(inputs).length) nodeProps.inputs = inputs;
      else delete nodeProps.inputs;
      return true;
    });
  };

  return (
    <Show when={info()}>
      {(part) => (
        <Column gap="200" pb="300">
          <Heading icon="puzzle-piece" title={part().label} subtitle={`A piece of ${part().moduleName}`}>
            <Show when={part().description}>
              <we-text variant="footnote">{part().description}</we-text>
            </Show>
          </Heading>

          <Column px="400" gap="100">
            <Show when={part().missing}>
              <Column gap="200" p="300" r="surface" bg="warning-surface">
                <we-text variant="footnote" color="warning-text">
                  {part().missing}
                </we-text>
                <Show when={part().fix}>
                  {(fix) => (
                    <Row>
                      <we-button size="xs" variant="secondary" onClick={() => fix().go()}>
                        {fix().label}
                      </we-button>
                    </Row>
                  )}
                </Show>
              </Column>
            </Show>

            <Show when={part().inputs.length}>
              <we-text {...SECTION_LABEL_PROPS}>It needs</we-text>
              <For each={part().inputs}>
                {(input) => (
                  <we-form-field
                    label={input.name}
                    description={`${input.description}. Leave empty to use whatever is named ${input.name} around it.`}
                    size="sm"
                  >
                    <we-input
                      size="sm"
                      value={inputValue(input.name)}
                      placeholder={input.name}
                      disabled={readOnly()}
                      on:change={(event: Event) =>
                        setInput(
                          input.name,
                          String((event as CustomEvent).detail ?? (event.target as HTMLInputElement).value),
                        )
                      }
                    />
                  </we-form-field>
                )}
              </For>
            </Show>

            <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
            <Route
              title="Restyle it"
              detail={`Colours, spacing and shape come from the theme. It stays ${part().moduleName}'s, so its updates keep arriving.`}
              action="Theme"
              onPress={() => host.session.openThemePanel()}
            />
            <Show
              when={readOnly()}
              fallback={
                <>
                  <Show when={nested() && !part().missing}>
                    <Route
                      title="Open it"
                      detail={`Arrange what is inside it yourself. The pieces stay ${part().moduleName}'s, so its fixes still reach them.`}
                      action="Open"
                      onPress={() => takeOver('one')}
                    />
                  </Show>
                  <Show when={!part().missing}>
                    <Route
                      title="Make it your own"
                      detail={`A copy of all of it, yours to change. It will no longer receive changes from ${part().moduleName}.`}
                      action="Copy"
                      onPress={() => takeOver('all')}
                    />
                  </Show>
                  <Route title="Remove it" detail="Take it out of this template." action="Remove" onPress={remove} />
                </>
              }
            >
              <ReadOnlyNote />
            </Show>
          </Column>
        </Column>
      )}
    </Show>
  );
}

// -----------------------------------------------------------------------
// A panel a module draws, or a section
// -----------------------------------------------------------------------

export function OwnerCard(props: { owner: OwnerRef }) {
  return (
    <Show when={props.owner.kind === 'panel'} fallback={<ViewCard id={props.owner.id} />}>
      <PanelCard dockId={props.owner.id} />
    </Show>
  );
}

function PanelCard(props: { dockId: string }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();
  const info = createMemo(() => host.owners?.panel(props.dockId) ?? null);
  const readOnly = () => host.session.isReadOnly();

  /**
   * Supply the panel's contents from the template, keeping the module in charge of whether it is up
   * and how big. Fills in the entry that already places this panel where there is one, so a panel
   * the template positions keeps its position; otherwise adds one.
   */
  const supply = (node: SchemaNode, forkedFrom?: string) => {
    const panel = info();
    if (!panel) return;
    const body = copyWithNewIds(node);
    if (forkedFrom) body.forkedFrom = forkedFrom;
    const written = write((template) => {
      const meta = ((template as TemplateSchema).meta ??= { name: '', description: '', icon: '' });
      const panels = (meta.panels ??= []) as TemplatePanel[];
      const existing = panels.find(
        (entry) => entry.module === panel.moduleId && !entry.node && (!entry.dock || entry.dock === panel.dock),
      );
      if (existing) Object.assign(existing, { dock: panel.dock, node: body });
      else
        panels.push({
          id: `${panel.moduleId}-${panel.dock}`,
          module: panel.moduleId,
          dock: panel.dock,
          node: body,
        } as TemplatePanel);
      return true;
    });
    // The panel's contents are the template's now, so the region it was is gone: select what is there.
    if (written) visualEditor.onSelect(body.id ?? null);
  };

  const arrange = () => {
    const node = host.owners?.panelNode(props.dockId);
    if (node) supply(node, `panel:${props.dockId}`);
  };

  const replace = () =>
    supply(
      ensureNodeIds({
        type: 'Column',
        props: { p: '400', gap: '200' },
        children: [{ type: 'we-text', props: { color: 'text-muted' }, children: ['Your own content for this panel.'] }],
      }),
    );

  return (
    <Show when={info()}>
      {(panel) => (
        <Column gap="200" pb="300">
          <Heading icon="squares-four" title={panel().title} subtitle={`A panel from ${panel().moduleName}`} />
          <Column px="400" gap="100">
            <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
            <Route
              title="Restyle it"
              detail={`Colours, spacing and shape come from the theme. It stays ${panel().moduleName}'s, so its updates keep arriving.`}
              action="Theme"
              onPress={() => host.session.openThemePanel()}
            />
            <Show
              when={readOnly()}
              fallback={
                <>
                  <Route
                    title="Arrange its pieces"
                    detail={
                      panel().composed
                        ? `Lay out what is in it yourself. The pieces stay ${panel().moduleName}'s, so its fixes still reach them, and it still decides when the panel opens.`
                        : `Copy its layout into this template to change it. It will no longer receive ${panel().moduleName}'s changes to the layout.`
                    }
                    action="Arrange"
                    onPress={arrange}
                  />
                  <Route
                    title="Replace it"
                    detail={`Put your own content in its place. ${panel().moduleName} still decides when it opens.`}
                    action="Replace"
                    onPress={replace}
                  />
                </>
              }
            >
              <ReadOnlyNote />
            </Show>
          </Column>
        </Column>
      )}
    </Show>
  );
}

function ViewCard(props: { id: string }) {
  const host = useEditorHost();
  const info = createMemo(() => host.owners?.view(props.id) ?? null);
  /** Asking before replacing a section for everyone — 'ask' once pressed, 'busy' while it saves. */
  const [step, setStep] = createSignal<'idle' | 'ask' | 'busy'>('idle');
  const [made, setMade] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal(false);

  const fork = async () => {
    setStep('busy');
    setFailed(false);
    const id = (await host.owners?.forkView?.(props.id)) ?? null;
    setMade(id);
    setFailed(!id);
    setStep('idle');
  };

  return (
    <Show when={info()}>
      {(view) => (
        <Column gap="200" pb="300">
          <Heading icon="browser" title={view().name} subtitle={`A section of this space, ${view().source}`}>
            <we-text variant="footnote">
              A section is a template of its own. The space decides which sections it has; this template decides where
              they go.
            </we-text>
          </Heading>
          <Column px="400" gap="100">
            <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
            <Route
              title="Restyle it"
              detail="Colours, spacing and shape come from the theme, so it stays the section it is and keeps its updates."
              action="Theme"
              onPress={() => host.session.openThemePanel()}
            />
            <Show when={host.owners?.forkView}>
              <Show
                when={!made()}
                fallback={
                  <Route
                    title="Your copy is in its place"
                    detail="Open it on its own to change it. Switch back to this template from the template menu when you are done."
                    action="Edit it"
                    onPress={() => host.owners?.openTemplate?.(made()!)}
                  />
                }
              >
                <Show
                  when={step() !== 'idle'}
                  fallback={
                    <Route
                      title="Make your own copy"
                      detail={
                        view().forkBlocked ||
                        `A copy of this section, yours to change, in its place for everyone in this space. It will no longer receive updates to ${view().name}, and its address changes.`
                      }
                      action="Copy"
                      disabled={!!view().forkBlocked}
                      onPress={() => setStep('ask')}
                    />
                  }
                >
                  <Column gap="200" p="300" r="surface" bg="warning-surface">
                    <we-text variant="footnote" color="warning-text">
                      Replace {view().name} with a copy for everyone here? The copy stops receiving updates to the
                      original.
                    </we-text>
                    <Row gap="200">
                      <we-button size="xs" variant="primary" loading={step() === 'busy'} onClick={fork}>
                        Make the copy
                      </we-button>
                      <we-button size="xs" variant="ghost" disabled={step() === 'busy'} onClick={() => setStep('idle')}>
                        Cancel
                      </we-button>
                    </Row>
                  </Column>
                </Show>
              </Show>
              <Show when={failed()}>
                <we-text variant="footnote" color="danger-text">
                  The copy could not be made.
                </we-text>
              </Show>
            </Show>
          </Column>
        </Column>
      )}
    </Show>
  );
}

// -----------------------------------------------------------------------
// The parts a template can place
// -----------------------------------------------------------------------

/** Nodes a part can go inside: layout that holds children, and anything already holding some. */
const CONTAINERS = new Set([
  'Column',
  'Row',
  'Grid',
  'Card',
  'Canvas',
  'div',
  'section',
  'main',
  'aside',
  'header',
  'footer',
  'nav',
  'article',
]);

export function acceptsParts(node: SchemaNode): boolean {
  if (node.type?.startsWith('$')) return false;
  return (
    CONTAINERS.has(node.type ?? '') ||
    !!node.children?.some((child) => typeof child === 'object' && child !== null && 'type' in child)
  );
}

/**
 * Every part a template can place here, to add inside the selected node.
 *
 * Nobody composes with a piece they cannot discover. The generated reference lists every part a
 * module publishes; until now the editor showed none of them, so a template author who did not read
 * the reference could not know a transcript feed or a microphone meter was there to be placed.
 *
 * Adding one appends it and selects it, so a part that needs names from around it says so at once.
 * The module goes into `meta.requires.modules`, which is how a template declares what it depends on —
 * and what lets a space without that module say what is missing rather than draw a hole.
 */
export function PartsPalette(props: { node: SchemaNode }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();
  const [search, setSearch] = createSignal('');

  const groups = createMemo(() => {
    const wanted = search().trim().toLowerCase();
    const parts = (host.owners?.parts() ?? []).filter(
      (part) =>
        !wanted ||
        part.label.toLowerCase().includes(wanted) ||
        part.moduleName.toLowerCase().includes(wanted) ||
        (part.description ?? '').toLowerCase().includes(wanted),
    );
    const byModule = new Map<string, OwnedPart[]>();
    for (const part of parts) byModule.set(part.moduleName, [...(byModule.get(part.moduleName) ?? []), part]);
    return [...byModule.entries()].map(([moduleName, entries]) => ({ moduleName, entries }));
  });

  const add = (part: OwnedPart) => {
    const placed = ensureNodeIds({ type: '$part', props: { id: part.id } });
    const written = write((template) => {
      const found = findNodeById(template, props.node.id ?? '');
      if (!found) return false;
      (found.node.children ??= []).push(placed);
      const meta = (template as TemplateSchema).meta;
      if (meta) {
        const requires = (meta.requires ??= {});
        const modules = (requires.modules ??= []);
        if (!modules.includes(part.moduleId)) modules.push(part.moduleId);
      }
      return true;
    });
    if (written && placed.id) visualEditor.onSelect(placed.id);
  };

  return (
    <Show when={host.owners && host.owners.parts().length}>
      <Column gap="200" px="400" py="300" borderTop="1px solid border">
        <we-text {...SECTION_LABEL_PROPS}>Add a module’s part</we-text>
        <we-input
          size="sm"
          placeholder="Search parts"
          value={search()}
          on:input={(event: Event) => setSearch(String((event as CustomEvent).detail ?? ''))}
        />
        <For each={groups()}>
          {(group) => (
            <Column gap="100">
              <we-text variant="footnote" color="text-muted">
                {group.moduleName}
              </we-text>
              <For each={group.entries}>
                {(part) => (
                  <Row ax="between" ay="center" gap="300" py="100">
                    <Column gap="0" flex="1 1 auto" minWidth="0">
                      <we-text variant="label">{part.label}</we-text>
                      <Show when={part.description}>
                        <we-text variant="footnote" color="text-muted">
                          {part.description}
                        </we-text>
                      </Show>
                    </Column>
                    <we-button size="xs" variant="ghost" disabled={host.session.isReadOnly()} onClick={() => add(part)}>
                      Add
                    </we-button>
                  </Row>
                )}
              </For>
            </Column>
          )}
        </For>
      </Column>
    </Show>
  );
}
