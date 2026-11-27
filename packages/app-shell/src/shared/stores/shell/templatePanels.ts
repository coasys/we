/**
 * The panels an interface declares: its own become docks (and every instance of one), a module's are
 * opened while the interface asks for them, a template may open more instances, and the arrangement
 * on screen can be saved back as a template. Part of `ShellStore` — see `../ShellStore.ts`.
 */
import { arrangedPanel, edgeOfSnap } from '@shared/dockGeometry';
import { isAppPanel } from '@shared/panelScope';
import {
  dockFrame,
  dockRegistry,
  registerHostDockStore,
  unregisterHostDockStore,
} from '@shared/registries/dockRegistry';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { instanceDockId, instanceKeyOf, type PanelInstance } from '@shared/registries/panelInstances';
import { slotRegistry } from '@shared/registries/slotRegistry';
import { TEMPLATE_DOCK_STORE_ID, templatePanelDockId, templatePanelScope } from '@shared/registries/templatePanels';
import { type ReactivityPort } from '@we/reactivity';
import { hasGesture, type SchemaNode } from '@we/schema-shared';

import { type ShellStore, type TemplateSaver } from '../ShellStore';
import { type ShellArrangement } from './arrangement';
import { type ShellDocks } from './docks';
import { type ShellViews } from './views';

/** Module ids already reported, so a memo re-running does not repeat itself every frame. */
const ambiguousSupply = new Set<string>();

/**
 * A template asked to supply "that module's panel" for a module that contributes several.
 *
 * Reported rather than guessed at. The entry has no way to say *which* panel it means, so the
 * honest answer is that the declaration is under-specified — and saying so names the fix (a panel
 * entry that identifies the dock) where picking one silently would not.
 */
/** Panel entries already reported, so a memo re-running does not repeat itself every frame. */
const unknownDock = new Set<string>();

/** A panel entry named a dock that module does not contribute. */
function warnUnknownDock(moduleId: string, dock: string): void {
  const key = `${moduleId}:${dock}`;
  if (unknownDock.has(key)) return;
  unknownDock.add(key);
  console.warn(
    `[panels] an interface supplies contents for "${key}", which module "${moduleId}" does not contribute. ` +
      'Nothing is supplied, so that module keeps its own contents — check the dock name against the module.',
  );
}

function warnAmbiguousSupply(moduleId: string, count: number): void {
  if (ambiguousSupply.has(moduleId)) return;
  ambiguousSupply.add(moduleId);
  console.warn(
    `[panels] an interface supplies contents for module "${moduleId}", which contributes ${count} panels. ` +
      'A panel entry names a module, so there is no way to tell which one is meant — none is supplied, ' +
      "and each keeps the module's own contents.",
  );
}

export function createShellTemplatePanels(deps: {
  reactivity: ReactivityPort;
  views: Pick<ShellViews, 'activeShellView' | 'setActiveShellView'>;
  arrangement: Pick<
    ShellArrangement,
    | 'closedPanels'
    | 'declaredPanels'
    | 'dockIdFor'
    | 'instancesHere'
    | 'placementKey'
    | 'raise'
    | 'setClosedPanels'
    | 'writeInstances'
  >;
  docks: Pick<
    ShellDocks,
    'dockRegistryVersion' | 'dockRequests' | 'panelsHiddenByUser' | 'placementOf' | 'setPanelsHiddenByUser'
  > & {
    members: Pick<ShellDocks['members'], 'revealDock'>;
  };
}) {
  const { reactivity } = deps;
  const { signal, memo, effect, untrack, onCleanup } = reactivity;
  const { activeShellView, setActiveShellView } = deps.views;
  const {
    closedPanels,
    declaredPanels,
    dockIdFor,
    instancesHere,
    placementKey,
    raise,
    setClosedPanels,
    writeInstances,
  } = deps.arrangement;
  const { dockRegistryVersion, dockRequests, panelsHiddenByUser, placementOf, setPanelsHiddenByUser } = deps.docks;
  const { revealDock } = deps.docks.members;
  /**
   * What "save this arrangement as a template" needs and this store cannot see: the schema on
   * screen, and a library to put a copy in. Injected, for the reason `moduleGate` is.
   */
  const [templateSaver, setTemplateSaver] = signal<TemplateSaver | null>(null);
  /*
    Turn the declarations that carry their own content into real docks.

    A template panel is a dock whose node came from a template and whose open flag the *shell* owns,
    because there is no module to own it — the arrangement `shellDocks.ts` already uses for space
    settings, one level more dynamic. The keys are per panel (`edge:<id>`) because `DockEntry` names
    its keys as strings and the set of panels is not known until a template says so.

    Diffed rather than cleared and rebuilt: `dockRegistry.register` announces, the geometry memo
    re-runs on every announcement, and a template being edited re-declares on every keystroke. A
    rebuild would drop and recreate every frame under the editor's cursor.
  */
  let registeredPanels: string[] = [];
  effect(() => {
    const authored = declaredPanels().filter((panel) => panel.node && !panel.module);

    const keys: Record<string, unknown> = {};
    for (const panel of authored) {
      const dockId = templatePanelDockId(panel.id);
      /*
        One key answering both "where" and "whether", exactly as a module's does: closed is null.

        Scoped by the same key positions use — and asked with the **dock** id, which is what makes
        that true. `placementKey` scopes a key only when a declaration exists for it, and
        `declarationFor` is indexed by dock id, so asking with the bare panel id answered "no
        declaration" every time and closed state fell back to the unscoped key it was meant to have
        left behind. Inert until now, because the map is cleared on a template switch anyway; a
        reset for the whole arrangement has to be able to find these.
      */
      const closedKey = placementKey(dockId);
      /*
        Closed when somebody closed it, or — for one declared `open: false` — until somebody opens it.
        The map holds `true` for closed and `false` for opened, so absent is the declaration's answer.
      */
      keys[`edge:${panel.id}`] = () =>
        (closedPanels()[closedKey] ?? panel.open === false) ? null : (edgeOfSnap(panel.snap ?? null) ?? 'right');
      keys[`size:${panel.id}`] = () => panel.size ?? 'md';
      keys[`float:${panel.id}`] = () => !panel.displace;
      keys[`min:${panel.id}`] = () => panel.min;

      if (!registeredPanels.includes(dockId)) {
        const entry = {
          id: dockId,
          moduleId: TEMPLATE_DOCK_STORE_ID,
          edge: `edge:${panel.id}`,
          size: `size:${panel.id}`,
          float: `float:${panel.id}`,
          min: `min:${panel.id}`,
          /*
            A written-out action rather than a `close:<id>` key beside the three above.

            Those three are read in TypeScript, through `readDockKey`, which resolves against
            `hostDockStores` — where these keys live. The close button is not: it is rendered into the
            titlebar as a schema `$invoke` against `storeRef`, and the renderer resolves `shellStore`
            to this store's real surface, where `close:interpretation` is not a member. It rendered, took
            the click, and logged. See `closeAction` in `dockRegistry.ts`.
          */
          closeAction: { $invoke: 'viewState.closeTemplatePanel', args: [panel.id] },
          // What a tab strip calls it, when it shares a seat.
          title: panel.title,
          // Named outright rather than through `modules.<id>`, the way the editor's and the shell's
          // own docks are — this store is the host's, not an installable module's.
          storeRef: 'shellStore',
          node: panel.node as SchemaNode,
          order: panel.order,
        };
        dockRegistry.register(entry);
        slotRegistry.register({
          anchor: 'dock-right',
          order: panel.order,
          id: `dock:${dockId}`,
          /*
            The frame wraps a *marker*, not the node.

            Everything in the slot registry is drawn with the chrome bag, because everything in it is
            chrome — including this frame, whose grip and menus name `host-layout` members no
            template may have. The node inside is the template's, and rendered through the same bag
            it could name `runtimeStore`, `editorStore` and the rest: an escalation reached by
            declaring a panel rather than by being granted anything. `TemplatePanelBody` looks the
            declaration up by id and renders it with the template's own bag.
          */
          node: dockFrame(entry, { type: 'TemplatePanelBody', props: { panelId: panel.id } }),
        });
      }
    }

    /*
      And every instance of one: a dock of its own, open while it exists, with the declaration's size
      and floor, and its body told which instance it is (see `TemplatePanelBody`).
    */
    const instances = Object.values(instancesHere()).filter((instance) =>
      authored.some((panel) => panel.id === instance.panel),
    );
    for (const instance of instances) {
      const panel = authored.find((entry) => entry.id === instance.panel)!;
      const key = instance.id.replace(/^template:/, '');
      keys[`edge:${key}`] = () => edgeOfSnap(panel.snap ?? null) ?? 'right';
      keys[`size:${key}`] = () => panel.size ?? 'md';
      keys[`float:${key}`] = () => !panel.displace;
      keys[`min:${key}`] = () => panel.min;
      if (!registeredPanels.includes(instance.id)) {
        const entry = {
          id: instance.id,
          moduleId: TEMPLATE_DOCK_STORE_ID,
          edge: `edge:${key}`,
          size: `size:${key}`,
          float: `float:${key}`,
          min: `min:${key}`,
          closeAction: { $invoke: 'viewState.closePanel', args: [instance.id] },
          title: instance.title ?? panel.title,
          storeRef: 'shellStore',
          node: panel.node as SchemaNode,
          order: panel.order,
        };
        dockRegistry.register(entry);
        slotRegistry.register({
          anchor: 'dock-right',
          order: panel.order,
          id: `dock:${instance.id}`,
          node: dockFrame(entry, { type: 'TemplatePanelBody', props: { panelId: panel.id, instance: instance.id } }),
        });
      }
    }

    // Withdraw anything the interface has stopped declaring, or the panel outlives the template.
    const live = [
      ...authored.map((panel) => templatePanelDockId(panel.id)),
      ...instances.map((instance) => instance.id),
    ];
    for (const dockId of registeredPanels) {
      if (live.includes(dockId)) continue;
      dockRegistry.remove(dockId);
      slotRegistry.remove(`dock:${dockId}`);
    }
    registeredPanels = live;

    registerHostDockStore(TEMPLATE_DOCK_STORE_ID, keys);
  });

  onCleanup(() => {
    for (const dockId of registeredPanels) {
      dockRegistry.remove(dockId);
      slotRegistry.remove(`dock:${dockId}`);
    }
    unregisterHostDockStore(TEMPLATE_DOCK_STORE_ID);
  });

  /*
    Open the module panels the interface asked for, and put them back when it stops asking.

    A declaration places a panel; it does not open one, because whether a module's panel is open is
    the module's own state and the host has no business writing it. So the host asks the module,
    through the two keys the launcher already declares: read `activeWhen`, and fire `action` only if
    it is false. That matters rather than being fastidious — transcribe's action is `togglePanel`,
    so firing it blindly at an open panel would *close* the thing the template asked for.

    ## Provenance, which is the whole reason this keeps a set

    A panel opened by a layout is the layout's, and is withdrawn when the layout stops naming it. A
    panel somebody opened themselves is theirs and survives navigating between views. Without the
    distinction a per-view layout either accumulates every panel you have walked past, or closes one
    holding live state — leaving the graph view would stop a recording.
  */
  const layoutOpened = new Set<string>();
  /**
   * Put one of a module's panels into the state asked for.
   *
   * By **dock**, not by module: a module with two panels has two answers. The registry holds the
   * host's controls for every panel — its own flag where the module did not claim one, the module's
   * named actions where it did — so this asks the registry and never a store. From the module
   * registry rather than the dock registry, for `dockIdFor`'s reason: reading the dock registry
   * inside an effect that registers into it is what closed the loop.
   */
  const setModulePanel = (dockId: string, wantOpen: boolean): void => {
    const controls = moduleRegistry.panel(dockId);
    if (!controls || controls.isOpen() === wantOpen) return;
    if (wantOpen) controls.open();
    else controls.close();
  };

  effect(() => {
    dockRegistryVersion();
    const wanted = declaredPanels()
      // `open: false` places without opening. Opening goes through the panel's own controls — the
      // host's flag, or the `show` key a module named — and is not always wanted on entering a
      // space: the call's stage opened with nobody in it is an empty window over the content.
      .filter((panel) => panel.module && panel.open !== false)
      /*
        By dock, not by module: the set is keyed by what it holds, and a module with two declared
        panels must give two entries.
      */
      .map((panel) => dockIdFor(panel))
      .filter((id): id is string => id !== null);

    for (const dockId of wanted) {
      if (layoutOpened.has(dockId)) continue;
      layoutOpened.add(dockId);
      setModulePanel(dockId, true);
    }
    for (const dockId of [...layoutOpened]) {
      if (wanted.includes(dockId)) continue;
      layoutOpened.delete(dockId);
      setModulePanel(dockId, false);
    }
  });

  const members: Pick<
    ShellStore,
    | 'provideTemplateSaver'
    | 'saveArrangementAsTemplate'
    | 'openPanel'
    | 'openTemplatePanel'
    | 'panelSupplied'
    | 'openModulePanel'
    | 'closeModulePanel'
    | 'toggleModulePanel'
  > = {
    provideTemplateSaver: setTemplateSaver,

    saveArrangementAsTemplate: async () => {
      const saver = templateSaver();
      const schema = saver?.current();
      const panels = schema?.meta?.panels;
      if (!saver || !schema || !panels) return false;

      /*
        The declaration, with the reader's answers written over the author's.

        Only the coordinates: where each section is (`home` or `snap`), where in its lane (`order`,
        `band`, `tab`) and how it shares room (`grow`). The tree is untouched, and so is everything
        in an entry that is not a position — its node, its title, its floor. A fork made this way is
        the same template with a different opening arrangement, which is the whole of what was
        asked for.
      */
      const arranged = panels.map((panel) => {
        const id = dockIdFor(panel);
        const request = id ? dockRequests().find((entry) => entry.id === id) : undefined;
        return id && request ? arrangedPanel(panel, placementOf(request)) : panel;
      });

      /*
        The id and the name go through untouched, and the library decides what they become.

        The schema carries the id it was forked from, so a plain save on a built-in would land *on*
        it. `saveTemplateAs` reserves the id and renames when it does, so the same call forks a
        built-in and saves in place on something you already own.

        Not the naming picker, which is what a considered fork gets: that lives on `editorStore`
        and this store has no edge to it. Worth doing when one exists — a reader would rather say
        what an arrangement is for than be handed a suffix.
      */
      return saver.save({ ...schema, meta: { ...schema.meta, panels: arranged } });
    },
    openPanel: (panel, inputs = {}, options = {}) => {
      const declared = declaredPanels().find((entry) => entry.id === panel && entry.node && !entry.module);
      if (!declared) {
        console.warn(`[shellStore] openPanel: "${panel}" is not a panel this interface supplies.`);
        return '';
      }
      /*
        The app's own panels are not the interface's to open. `chat-global`/`chat-space` arrive
        merged under it, so the id resolves — and the instance would open a chat on the template's
        inputs where `chatStore.openChat` is the way a template asks: pinned to a scope it may hold,
        prefilled rather than sent. The bag marks a template's call `viaTemplate`; host code reaches
        the same panel without it, which is why the mark and not the panel decides.
      */
      if (options.viaTemplate && isAppPanel(declared)) {
        console.warn(
          `[shellStore] openPanel: "${panel}" is the app's own — a template opens a chat through chatStore.openChat.`,
        );
        return '';
      }
      const id = instanceDockId(panel, options.key ?? instanceKeyOf(inputs));
      // Strictly after every instance already open, however quickly they were opened.
      const openedNow = (here: Record<string, PanelInstance>) =>
        Math.max(Date.now(), ...Object.values(here).map((instance) => instance.opened + 1));
      writeInstances(options.scope ?? templatePanelScope(), (here) => ({
        ...here,
        [id]: {
          id,
          panel,
          inputs,
          opened: here[id]?.opened ?? openedNow(here),
          ...(options.title ? { title: options.title } : {}),
        },
      }));
      /*
        Opened on purpose, so wanted in sight — `revealDock` says that for every panel asked for:
        back from behind a shell view or a panels-hidden state, out of a strip or a fold, in front.
        An instance opened before has its dock already registered, so it takes that path whole. One
        just created does not — the effect registering it runs after this call — and `revealDock`
        would find no request and return. What it would have said for a dock that has never been laid
        out (no strip, no fold yet) is exactly this.

        Through a template, though, "asked for" is the template's saying rather than a person's —
        `openPanel` is ambient because a template's panels open unasked, but pulling Settings down
        or the hidden dock back up is nobody's click. `hasGesture`, not `claimGesture`: the
        ambient call must not spend the press another action in the same handler may need.
      */
      const reveal = !options.viaTemplate || hasGesture();
      if (!reveal) return id;
      if (dockRequests().some((request) => request.id === id)) {
        revealDock(id);
      } else {
        if (panelsHiddenByUser()) setPanelsHiddenByUser(false);
        if (activeShellView()) setActiveShellView(null);
        raise(id);
      }
      return id;
    },

    openTemplatePanel: (id) => {
      const dockId = templatePanelDockId(id);
      const key = placementKey(dockId);
      // `false` rather than deleted, so a panel declared closed (`open: false`) stays open once opened.
      setClosedPanels({ ...untrack(closedPanels), [key]: false });
      // Opened on purpose, so in sight: a panel reopening into a stack comes back as the tab in front
      // rather than behind whichever was touched last. See `revealDock`.
      revealDock(dockId);
    },

    /*
      Which *docks* an interface has supplied the contents of, keyed by dock id.

      A template's entry names a module, because "the transcribe panel, arranged my way" is the
      question its author is asking. Resolving that name to a dock is this memo's job, and it is
      done here rather than at the gate because only the shell can see the dock registry.

      One dock is the whole of the current world and the easy case. None means the module is not
      installed in this deployment, which is ordinary — an interface declaring a panel for a module
      a deployment left out should render nothing, not complain.

      Several is the case worth refusing. Supplying all of them would put one body inside every
      panel that module contributes, so overriding its transcript would silently overwrite its
      settings panel; picking the first would be a guess that reads as correct until it isn't.
      So it supplies none and says why — a panel showing the module's own contents is a visible,
      correctable outcome, where the wrong contents in the right frame is not.
    */
    panelSupplied: memo(() => {
      dockRegistryVersion();
      const supplied: Record<string, boolean> = {};
      for (const panel of declaredPanels()) {
        if (!panel.module || !panel.node) continue;
        // The same resolver the placement chain uses — see `dockIdFor`. Two copies of this question
        // is how the placements broke: one learned about named docks and the other did not.
        const id = dockIdFor(panel);
        if (id && dockRegistry.ordered().some((entry) => entry.id === id)) {
          supplied[id] = true;
          continue;
        }
        if (panel.dock) warnUnknownDock(panel.module, panel.dock);
        else
          warnAmbiguousSupply(panel.module, dockRegistry.ordered().filter((e) => e.moduleId === panel.module).length);
      }
      return supplied;
    }),

    openModulePanel: (dockId) => setModulePanel(dockId, true),
    closeModulePanel: (dockId) => setModulePanel(dockId, false),
    toggleModulePanel: (dockId) => {
      const controls = moduleRegistry.panel(dockId);
      if (controls) setModulePanel(dockId, !controls.isOpen());
    },
  };
  return { members };
}

export type ShellTemplatePanels = ReturnType<typeof createShellTemplatePanels>;
