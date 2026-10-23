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
  partForkChanged,
  type SchemaNode,
  type TemplatePanel,
  type TemplateSchema,
} from '@we/schema-shared';
import { type OwnerRef, useVisualEditor } from '@we/schema-solid';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { type OwnedPart, useEditorHost } from '../host';
import { deepClone, lastOf } from '../utils';
import { levelsAbove, selectLevel } from './partLevels';

/** Names in a sentence: "A", "A and B", "A, B and C". */
const listed = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${lastOf(names)}`;

/** One route out of an owned region: what it does, what it costs, and the button. */
function Route(props: { title: string; detail: string; action: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Column gap="100" py="200">
      <Row ax="between" ay="center" gap="300">
        <we-text variant="label">{props.title}</we-text>
        <we-button size="xs" variant="soft" disabled={props.disabled} onClick={props.onPress}>
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
              <Column gap="200" p="300" r="surface" bg="warning-soft">
                <we-text variant="footnote" color="warning-text">
                  {part().missing}
                </we-text>
                <Show when={part().fix}>
                  {(fix) => (
                    <Row>
                      <we-button size="xs" variant="soft" onClick={() => fix().go()}>
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
    <Show when={props.owner.kind !== 'part-node'} fallback={<PartNodeCard owner={props.owner} />}>
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
function PartNodeCard(props: { owner: OwnerRef }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();
  const readOnly = () => host.session.isReadOnly();

  const chain = () => props.owner.chain ?? [];
  const infos = createMemo(() =>
    (props.owner.parts ?? []).map((id) => host.owners?.part(id)).filter((p): p is OwnedPart => !!p),
  );
  const labelOf = (part: string) => host.owners?.part(part)?.label ?? part;
  /** The levels above this node, outermost first, each one a step of the path in the heading. */
  const above = createMemo(() => levelsAbove(props.owner));
  const within = () => lastOf(infos());
  const moduleName = () => within()?.moduleName ?? 'its module';
  /** The parts the copy opens: every one on the path, less the last when the node is itself a placement. */
  const opened = () => infos().slice(0, lastOf(chain()) === props.owner.id ? -1 : undefined);

  const makeOwn = () => {
    let picked: string | undefined;
    write((template) => {
      const found = findNodeById(template, chain()[0] ?? '');
      const path = found && host.owners?.openPath?.(found.node, chain(), props.owner.id);
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
        title={props.owner.name}
        subtitle={within() ? `Inside ${within()!.label}, a part of ${moduleName()}` : 'Inside a module’s part'}
      >
        {/* Where it is, from the part the template placed down to it. Every level above it can be
            selected from here, as Escape selects the next one up — the way back from a press that
            went straight in. */}
        <Row gap="100" ay="center" wrap>
          <For each={above()}>
            {(level, i) => (
              <>
                <we-button
                  size="xs"
                  variant="ghost"
                  onClick={() => selectLevel(visualEditor, props.owner, i(), labelOf)}
                >
                  {labelOf(level.part)}
                </we-button>
                <we-icon name="caret-right" size="xs" color="text-faint" />
              </>
            )}
          </For>
          <we-text variant="footnote">{props.owner.name}</we-text>
        </Row>
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
              detail={`Opens ${listed(opened().map((part) => part.label))} into this template, so this is yours to change. Those stop receiving ${moduleName()}’s changes; everything else in them stays ${moduleName()}’s.`}
              action="Copy"
              onPress={makeOwn}
            />
          </Show>
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
                        ? `Lay out what is in it yourself. ${listed(panel().placed)} stay ${panel().moduleName}'s, so its fixes still reach them; the layout around them becomes yours. ${panel().moduleName} still decides when the panel opens.`
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
  const visualEditor = useVisualEditor();
  const info = createMemo(() => host.owners?.view(props.id) ?? null);
  /** Whether a section can be edited where it is: one this agent may change, a stored copy. */
  const canChangeHere = (id: string | null) => !!id && !!host.targets?.canEditSection(id);
  /** Edit it in this shell, where it is seen. The press that follows selects inside it. */
  const changeHere = (id: string) => {
    if (host.targets?.enterSection(id)) visualEditor.onSelectOwner(null);
  };
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

  /*
    A copy is made to be changed, so it is gone into as soon as it can be, as a forked template is
    opened for editing. The question worth asking — replacing the section for everyone — was the
    confirmation; going in commits nothing more. Watched rather than done after the await, because
    the copy becomes editable when the template lists hear of it, which can be a moment later. A copy
    that never can be — one this shell cannot reach — keeps the card's way to open it on its own.
  */
  let wentIn = false;
  createEffect(() => {
    const copy = made();
    if (!copy || wentIn || !canChangeHere(copy)) return;
    wentIn = true;
    changeHere(copy);
  });

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
            <Show when={canChangeHere(props.id)}>
              <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
              <Route
                title="Change it here"
                detail="Edit it where it is, in this shell. Your changes are saved to it for everyone who sees it."
                action="Change"
                onPress={() => changeHere(props.id)}
              />
            </Show>
            <Show when={host.owners?.forkView && !canChangeHere(props.id)}>
              <we-text {...SECTION_LABEL_PROPS}>Change it</we-text>
              <Show
                when={!made()}
                fallback={
                  <Show
                    when={canChangeHere(made())}
                    fallback={
                      <Route
                        title="Your copy is in its place"
                        detail="Open it on its own to change it. Switch back to this template from the template menu when you are done."
                        action="Edit it"
                        onPress={() => host.owners?.openTemplate?.(made()!)}
                      />
                    }
                  >
                    <Route
                      title="Your copy is in its place"
                      detail="Change it where it is, in this shell."
                      action="Change it here"
                      onPress={() => changeHere(made()!)}
                    />
                  </Show>
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
                  <Column gap="200" p="300" r="surface" bg="warning-soft">
                    <we-text variant="footnote" color="warning-text">
                      Replace {view().name} with a copy for everyone here? The copy stops receiving updates to the
                      original.
                    </we-text>
                    <Row gap="200">
                      <we-button size="xs" variant="solid" loading={step() === 'busy'} onClick={fork}>
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
          <we-button size="xs" variant="soft" disabled={host.session.isReadOnly()} onClick={giveBack}>
            Give it back
          </we-button>
        </Row>
      </Column>
    </Show>
  );
}

// -----------------------------------------------------------------------
// A section edited on its own
// -----------------------------------------------------------------------

/**
 * Where you are when a section is on screen by itself, and the way back to the shell it lives in.
 *
 * A section is a template of its own, and the editor edits the template on screen, so editing a
 * section opens it alone — the shell around it gone. Without saying so that reads as the rest of the
 * template having vanished, and the way back was a template menu nobody had been told about. Editing
 * a section in place, inside its shell, is a change to what the editor edits; until then this says
 * what is happening and offers the way back.
 */
export function SectionOnItsOwnBar() {
  const host = useEditorHost();
  const state = createMemo(() => host.owners?.sectionOnItsOwn?.() ?? null);
  return (
    <Show when={state()}>
      {(on) => (
        <Row
          data-we-section-on-its-own=""
          ax="between"
          ay="center"
          gap="300"
          mx="300"
          mb="200"
          px="300"
          py="200"
          r="surface"
          bg="surface-sunken"
          flexShrink="0"
        >
          <we-text variant="footnote" color="text-muted">
            {on().shell
              ? `Editing ${on().section} on its own, a section of ${on().shell!.name}.`
              : `Editing ${on().section} on its own. Switch back to a shell from the template menu.`}
          </we-text>
          <Show when={on().shell}>
            {(shell) => (
              <we-button size="xs" variant="soft" onClick={() => shell().back()}>
                Back to {shell().name}
              </we-button>
            )}
          </Show>
        </Row>
      )}
    </Show>
  );
}

/**
 * Where you are while a section or the app is edited where it is drawn, and the way out.
 *
 * What the inspector shows and what the editor saves is the section's or the app's, not the page's,
 * and nothing on screen changes to say so — the section or the chrome looks exactly as it does when
 * it is not being edited. WE's own app is built in, so the bar offers to fork it straight away rather
 * than only after a change, which is what makes forking the app something you can set out to do.
 */
export function EditingSectionBar() {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const section = createMemo(() => host.targets?.section() ?? null);
  const app = createMemo(() => host.targets?.app?.() ?? null);
  const leave = () => {
    host.targets?.leave();
    visualEditor.onSelect(null);
  };
  /** Where you are, in a sentence — or nothing, while it is the page. */
  const where = () => {
    const on = section();
    if (on) return `Editing ${on.name}, a section of this space, where it is.`;
    const editingApp = app();
    if (editingApp) return `Editing ${editingApp.name}, the app around every space.`;
    return null;
  };
  return (
    <Show when={where()}>
      {(sentence) => (
        <Row
          data-we-editing-section=""
          ax="between"
          ay="center"
          gap="300"
          mx="300"
          mb="200"
          px="300"
          py="200"
          r="surface"
          bg="accent-soft"
          flexShrink="0"
        >
          <we-text variant="footnote">{sentence()} Escape or a press outside it comes back out.</we-text>
          <Row gap="200" flexShrink="0">
            <Show when={app() && host.session.isReadOnly()}>
              <we-button size="xs" variant="solid" onClick={() => host.session.startFork()}>
                Fork
              </we-button>
            </Show>
            <we-button size="xs" variant="soft" onClick={leave}>
              Done
            </we-button>
          </Row>
        </Row>
      )}
    </Show>
  );
}

/**
 * What the session is editing: the page — the template on screen, and its sections — or the app
 * around it. One at a time, and this is the way across in either direction.
 *
 * In the editor's bar rather than the inspector, so the app can be gone into without a page node
 * selected first, and so the choice is on screen for the whole session. Absent where the host has no
 * app to edit, as an editor embedded in somebody else's application has none.
 */
export function EditTargetSwitch() {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const onApp = () => !!host.targets?.app?.();
  const toPage = () => {
    if (!onApp()) return;
    host.targets?.leave();
    visualEditor.onSelect(null);
  };
  const toApp = () => {
    if (onApp()) return;
    if (host.targets?.enterApp?.()) visualEditor.onSelect(null);
  };
  return (
    <Show when={host.targets?.enterApp}>
      <Row ay="center" gap="100" data-we-edit-target-switch="">
        <we-tooltip content="Edit the template on screen" placement="bottom">
          <we-button size="sm" variant={onApp() ? 'ghost' : 'soft'} onClick={toPage}>
            Page
          </we-button>
        </we-tooltip>
        <we-tooltip content="Edit the app around every space: the sidebar, the rail" placement="bottom">
          <we-button size="sm" variant={onApp() ? 'soft' : 'ghost'} onClick={toApp}>
            App
          </we-button>
        </we-tooltip>
      </Row>
    </Show>
  );
}

// -----------------------------------------------------------------------
// A module's part the template copied
// -----------------------------------------------------------------------

/** The nodes from the root down to `id`, root first; empty when it is not in the tree. */
function pathTo(template: SchemaNode, id: string): SchemaNode[] {
  const path: SchemaNode[] = [];
  let found = findNodeById(template, id);
  if (!found) return path;
  path.unshift(found.node);
  while (found?.parent) {
    path.unshift(found.parent);
    found = found.parent.id ? findNodeById(template, found.parent.id) : null;
  }
  return path;
}

/** Every copied level inside a node, itself included, outermost first. */
function forksWithin(node: SchemaNode): SchemaNode[] {
  const out: SchemaNode[] = [];
  forEachNode(node, (each) => {
    if (each.forkedPart) out.push(each);
  });
  return out;
}

/**
 * The way back from copying a module's part: the placement it replaced, and the module drawing it.
 *
 * Shown above any node inside a copy. What goes back is the outermost copied level — what the
 * template placed — since a level cannot go back while something below it stays the template's: the
 * module would draw its own version of that something in its place.
 *
 * What it costs is said first. Each copied level carries a fingerprint of itself as copied, so the
 * note can say which levels have been changed since — and, where some have not, offer to give back
 * just those: the unchanged levels below the changes go back to the module, and every change stays.
 */
export function CopiedPartNote(props: { nodeId: string }) {
  const host = useEditorHost();
  const visualEditor = useVisualEditor();
  const write = useTemplateWriter();

  const forks = createMemo(() => {
    const template = host.template.currentTemplate as SchemaNode;
    const outermost = pathTo(template, props.nodeId).find((node) => node.forkedPart);
    if (!outermost) return null;
    const all = forksWithin(outermost);
    /** A level is dirty when it, or any level copied inside it, has changed since it was copied. */
    const dirty = new Map<SchemaNode, boolean>();
    for (const level of [...all].reverse()) {
      dirty.set(
        level,
        partForkChanged(level) || forksWithin(level).some((inner) => inner !== level && dirty.get(inner)),
      );
    }
    const changed = all.filter((level) => partForkChanged(level));
    // The unchanged levels that can go back on their own: clean, and held by a level that is not.
    const returnable = all.filter((level) => {
      if (dirty.get(level)) return false;
      const holder = lastOf(all.filter((other) => other !== level && forksWithin(other).includes(level)));
      return !!holder && dirty.get(holder);
    });
    return { outermost, changed, returnable, clean: !dirty.get(outermost) };
  });

  const partOf = (level: SchemaNode) => {
    const id = String(level.forkedPart?.placement.id ?? '');
    return host.owners?.part(id) ?? null;
  };
  const labelOf = (level: SchemaNode) => partOf(level)?.label ?? String(level.forkedPart?.placement.id ?? 'a part');
  const moduleName = () => {
    const found = forks();
    return (found && partOf(found.outermost)?.moduleName) || 'its module';
  };

  /** Put each level back as the placement it replaced. */
  const giveBack = (levels: SchemaNode[]) => {
    const ids = levels.map((level) => level.id).filter((id): id is string => !!id);
    let first: string | undefined;
    const written = write((template) => {
      for (const id of ids) {
        const found = findNodeById(template, id);
        if (!found?.node.forkedPart) return false;
        const placement = ensureNodeIds({
          type: '$part',
          props: deepClone(found.node.forkedPart.placement) as SchemaNode['props'],
        });
        first ??= placement.id;
        for (const key of Object.keys(found.node)) delete (found.node as Record<string, unknown>)[key];
        Object.assign(found.node, placement);
      }
      return true;
    });
    if (!written) return;
    // The node selected may have gone back with a level; if so, select what replaced the outermost.
    if (!findNodeById(host.template.currentTemplate as SchemaNode, props.nodeId)) visualEditor.onSelect(first ?? null);
  };

  return (
    <Show when={forks()}>
      {(found) => (
        <Column gap="200" mx="400" mt="300" p="300" r="surface" bg="surface-sunken">
          <Row ay="center" gap="200">
            <we-icon name="puzzle-piece" size="sm" color="text-muted" />
            <we-text variant="label">
              {labelOf(found().outermost)}, copied from {moduleName()}
            </we-text>
          </Row>
          <Show
            when={!found().clean}
            fallback={
              <Route
                title="Give it back"
                detail={`${moduleName()} draws it again. Nothing in it has changed since it was copied.`}
                action="Give back"
                disabled={host.session.isReadOnly()}
                onPress={() => giveBack([found().outermost])}
              />
            }
          >
            <we-text variant="footnote" color="text-muted">
              Changed since copying: {listed(found().changed.map(labelOf))}.
            </we-text>
            <Route
              title="Give it all back"
              detail={`${moduleName()} draws it again, and your changes to ${listed(found().changed.map(labelOf))} are lost.`}
              action="Give back"
              disabled={host.session.isReadOnly()}
              onPress={() => giveBack([found().outermost])}
            />
            <Show when={found().returnable.length}>
              <Route
                title="Give back what you have not changed"
                detail={`${listed(found().returnable.map(labelOf))} ${found().returnable.length === 1 ? 'goes' : 'go'} back to ${moduleName()}. Your changes stay.`}
                action="Give back"
                disabled={host.session.isReadOnly()}
                onPress={() => giveBack(found().returnable)}
              />
            </Show>
          </Show>
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
