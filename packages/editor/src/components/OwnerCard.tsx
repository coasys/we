/**
 * What the inspector says about a region somebody else provides — a part the template placed, a
 * panel a module draws, a section — and the routes to taking it over.
 *
 * A region that is owned elsewhere is not a fault in the template, and the worst thing it can do is
 * sit there inert with nothing said. Selected, it names its owner and offers what can be done, the
 * cheapest first:
 *
 * 1. **Arrange its pieces** (a panel) or **open it** (a part). The arrangement becomes the template's
 *    and the pieces stay the module's, so a fix to one still lands in it.
 * 2. **Make it your own.** A copy of all of it, which no longer receives the owner's changes. Said
 *    in so many words, because that is the cost and it is easy not to notice.
 * 3. **Replace** or **remove** it.
 *
 * No "restyle" route, though restyling is the cheapest of all: a region already follows the theme,
 * so a route here could only open the global theme editor, which says nothing about this region.
 * It belongs back when a region can carry a theme of its own.
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
  forEachNode,
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
            <Show when={!part().missing}>
              <we-text variant="footnote" color="text-muted">
                Press inside it to reach one of its pieces, or hold ⌘ or Ctrl to reach one directly.
              </we-text>
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
    <Show
      when={props.owner.kind !== 'part-node'}
      fallback={
        <PartNodeCard
          id={props.owner.id}
          name={props.owner.name}
          chain={props.owner.chain ?? []}
          parts={props.owner.parts ?? []}
        />
      }
    >
      <Show when={props.owner.kind === 'panel'} fallback={<ViewCard id={props.owner.id} />}>
        <PanelCard dockId={props.owner.id} />
      </Show>
    </Show>
  );
}

// -----------------------------------------------------------------------
// One node inside a part the template placed
// -----------------------------------------------------------------------

/** Marks the node somebody chose while the path to it is copied, so it can be found in the copy. */
const PICKED = '__weEditorPicked';

/**
 * A node somebody reached by going into a placed part — the avatar beside a message, inside the lines,
 * inside the feed.
 *
 * It is the module's, and the only way to change it is to own it. What that costs is the point of
 * the card: making it yours opens just the parts on the way to it, a level each, so everything beside
 * that path stays the module's and keeps its fixes. Owning the one part that holds it whole is still
 * a copy of that part — which is why the card names the parts it opens rather than saying "a copy".
 */
function PartNodeCard(props: { id: string; name: string; chain: string[]; parts: string[] }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();
  const readOnly = () => host.session.isReadOnly();

  const infos = createMemo(() => props.parts.map((id) => host.owners?.part(id)).filter((p): p is OwnedPart => !!p));
  const within = () => infos().at(-1);
  const moduleName = () => within()?.moduleName ?? 'its module';
  /** The parts the copy opens: every one on the path, less the last when the node is itself a placement. */
  const opened = () => infos().slice(0, props.chain.at(-1) === props.id ? -1 : undefined);
  const list = (names: string[]) =>
    names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

  const makeOwn = () => {
    let picked: string | undefined;
    write((template) => {
      const found = findNodeById(template, props.chain[0] ?? '');
      const path = found && host.owners?.openPath?.(found.node, props.chain, props.id);
      if (!found || !path) return false;
      (path.target as unknown as Record<string, unknown>)[PICKED] = true;
      const replacement = copyWithNewIds(path.node);
      forEachNode(replacement, (node) => {
        const record = node as unknown as Record<string, unknown>;
        if (!record[PICKED]) return;
        picked = node.id;
        delete record[PICKED];
      });
      // In place, as opening a whole part does, so whatever holds the part holds what replaced it.
      for (const key of Object.keys(found.node)) delete (found.node as Record<string, unknown>)[key];
      Object.assign(found.node, replacement);
      return true;
    });
    if (picked) visualEditor.onSelect(picked);
  };

  return (
    <Column gap="200" pb="300">
      <Heading
        icon="puzzle-piece"
        title={props.name}
        subtitle={within() ? `Inside ${within()!.label}, a part of ${moduleName()}` : 'Inside a module’s part'}
      >
        <Show when={infos().length > 1}>
          <we-text variant="footnote" color="text-muted">
            {infos()
              .map((part) => part.label)
              .join(' › ')}
          </we-text>
        </Show>
        <we-text variant="footnote">
          This is {moduleName()}’s, drawn the way it draws it, so it changes when {moduleName()} does.
        </we-text>
      </Heading>
      <Column px="400" gap="100">
        <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
        <Show when={!readOnly()} fallback={<ReadOnlyNote />}>
          <Show when={host.owners?.openPath}>
            <Route
              title="Make it your own"
              detail={`Opens ${list(opened().map((part) => part.label))} into this template, so this is yours to change. Those stop receiving ${moduleName()}’s changes; everything else in them stays ${moduleName()}’s.`}
              action="Copy"
              onPress={makeOwn}
            />
          </Show>
          <Route
            title={`Select ${infos()[0]?.label ?? 'the part'}`}
            detail="Go back to the part this template placed, to open, copy or remove all of it."
            action="Select"
            onPress={() => visualEditor.onSelect(props.chain[0] ?? null)}
          />
        </Show>
      </Column>
    </Column>
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
            <Show when={host.owners?.forkView}>
              <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
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
// A module's panel the template has arranged
// -----------------------------------------------------------------------

/** The `meta.panels` entry whose supplied contents hold this node, when it is a module's panel. */
function suppliedEntryHolding(template: SchemaNode, nodeId: string): TemplatePanel | undefined {
  const panels = ((template as TemplateSchema).meta?.panels ?? []) as TemplatePanel[];
  return panels.find((entry) => entry.module && entry.node && findNodeById(entry.node as SchemaNode, nodeId));
}

/** Keys an entry carries when arranging a panel made it, and nothing a template placed it with. */
const MADE_BY_ARRANGING = new Set(['id', 'module', 'dock', 'node']);

/**
 * The way back from "arrange its pieces": the panel goes back to how its module draws it.
 *
 * Shown above a node inside a module's panel the template supplies, since once arranged the panel's
 * contents are ordinary nodes of the template and nothing else would say whose panel they fill. Undo
 * reaches back only as far as this editing session, so without this an arrangement was permanent.
 *
 * Takes the template's contents out of the entry rather than deleting it, so a panel the template
 * also places — its edge, its size — stays placed. An entry arranging created, carrying nothing
 * else, is removed whole, which is exactly the template as it was before.
 */
export function SuppliedPanelNote(props: { nodeId: string }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();

  const entry = createMemo(() => suppliedEntryHolding(host.template.currentTemplate as SchemaNode, props.nodeId));
  const moduleName = () => {
    const found = entry();
    if (!found?.module) return '';
    return (found.dock && host.owners?.panel(`${found.module}:${found.dock}`)?.moduleName) || found.module;
  };

  const giveBack = () => {
    const id = entry()?.id;
    const written = write((template) => {
      const meta = (template as TemplateSchema).meta;
      const panels = (meta?.panels ?? []) as TemplatePanel[];
      const index = panels.findIndex((candidate) => candidate.id === id);
      if (index < 0) return false;
      const target = panels[index];
      if (Object.keys(target).every((key) => MADE_BY_ARRANGING.has(key))) panels.splice(index, 1);
      else delete (target as { node?: unknown }).node;
      return true;
    });
    if (written) visualEditor.onSelect(null);
  };

  return (
    <Show when={entry()}>
      <Column gap="200" mx="400" mt="300" p="300" r="surface" bg="surface-sunken">
        <Row ay="center" gap="200">
          <we-icon name="squares-four" size="sm" color="text-muted" />
          <we-text variant="label">{moduleName()}’s panel, arranged by this template</we-text>
        </Row>
        <we-text variant="footnote" color="text-muted">
          Giving it back throws this arrangement away, and the panel is drawn the way {moduleName()} draws it again.
        </we-text>
        <Row>
          <we-button size="xs" variant="secondary" disabled={host.session.isReadOnly()} onClick={giveBack}>
            Give it back
          </we-button>
        </Row>
      </Column>
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
