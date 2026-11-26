/**
 * What the reader has done to the arrangement, and what the interface declared: where each panel was
 * put and how recently it was touched, the panels closed, the instances open, the home lanes' widths
 * and folds, the layouts saved by name — and the declarations those are read against. Everything a
 * view-state profile member answers is here; the geometry that draws it is `docks.ts`.
 * Part of `ShellStore` — see `../ShellStore.ts`.
 */
import { type FloatPlacement, frontOf } from '@shared/dockGeometry';
import { APP_PANEL_SCOPE } from '@shared/panelScope';
import { dockRegistry } from '@shared/registries/dockRegistry';
import { type PanelInstance } from '@shared/registries/panelInstances';
import {
  onTemplatePanelsChanged,
  templatePanelDockId,
  templatePanels,
  templatePanelScope,
} from '@shared/registries/templatePanels';
import { type ReactivityPort } from '@we/reactivity';
import { type TemplatePanel } from '@we/schema-shared';

import { distinctSignal } from '../../distinctSignal';
import type { PlatformPort } from '../../platform/port';
import { type ShellHostState, type ShellStore } from '../ShellStore';
import {
  type LaneState,
  loadActivation,
  loadInstances,
  loadLanes,
  loadLayouts,
  loadPlacements,
  saveActivation,
  type SavedLayout,
  type SavedLayouts,
  saveInstances,
  saveLanes,
  saveLayouts,
  savePlacements,
} from './storage';

export function createShellArrangement(deps: {
  reactivity: ReactivityPort;
  /** Where the arrangement is kept: a preference about this device's window. */
  platform: Pick<PlatformPort, 'storage'>;
  host: Pick<ShellHostState, 'publishPanelInstances'>;
}) {
  const { reactivity } = deps;
  const { storage } = deps.platform;
  const { signal, memo, effect, untrack, onCleanup } = reactivity;
  const { publishPanelInstances } = deps.host;
  /**
   * Where each panel has been put, by dock id. Empty until somebody moves or resizes one.
   *
   * A preference about somebody's own window, so it persists per device and never travels in a
   * shared link — the same rule the sidebar's expanded state follows. Restored placements are
   * clamped into the viewport on resolve, so one saved on a monitor cannot leave a panel off-screen
   * on a laptop.
   */
  const [placements, setPlacements] = signal<Record<string, FloatPlacement>>(loadPlacements(storage));
  const [activation, setActivation] = signal<Record<string, number>>(loadActivation(storage));
  // Seeded from what was stored, so the first raise after a reload lands above everything that was
  // raised before it rather than restarting the count underneath.
  let activationClock = Math.max(0, ...Object.values(untrack(activation)));
  /** Bring a panel to the front. See `layerOrder`. */
  const raise = (id: string) => {
    const key = placementKey(id);
    /*
      Already on top is not a change, and saying so is what makes a tab clickable.

      A pointer landing anywhere on a frame raises it, which is right — but it fired on every press,
      including a press on the front panel's own tab strip. That rewrote the activation, which
      rebuilt the geometry, which rebuilt the strip's rows, which destroyed the button under the
      pointer *between its pointerdown and its pointerup* — so the browser had nothing to fire a
      `click` on and the tab did nothing at all. Raising the panel that is already raised had no
      other effect to lose.
    */
    if (activation()[key] === activationClock) return;
    {
      const prev = untrack(activation);
      const next = { ...prev, [key]: ++activationClock };
      saveActivation(storage, next);
      setActivation(next);
    }
  };
  const [layouts, setLayouts] = signal<SavedLayouts>(loadLayouts(storage));
  /**
   * The named layout the arrangement on screen is, or `''` once it has been changed since.
   *
   * Cleared by any write to a placement rather than compared on every read: the question is "did
   * somebody touch it", which is cheaper to remember than to re-derive, and a layout applied and
   * then dragged is no longer that layout whatever the pixels happen to say.
   */
  const [activeLayout, setActiveLayout] = distinctSignal(reactivity, '');

  const writePlacement = (id: string, next: FloatPlacement) => {
    setActiveLayout('');
    {
      const prev = untrack(placements);
      const merged = { ...prev, [placementKey(id)]: next };
      savePlacements(storage, merged);
      setPlacements(merged);
    }
  };
  /**
   * The panels the interface on screen declares, and which of them the reader has closed.
   *
   * A declaration is a *suggestion* — the middle rung of three, under whatever the user last
   * dragged and over the module's own opening bid. Closing one is remembered by panel id rather
   * than written back into the template, so a template can go on improving its layout without
   * arguing with a dismissal.
   */
  const [panelsVersion, setPanelsVersion] = signal(0);
  onCleanup(onTemplatePanelsChanged(() => setPanelsVersion(untrack(panelsVersion) + 1)));
  const declaredPanels = memo<readonly TemplatePanel[]>(() => {
    panelsVersion();
    return templatePanels();
  });

  /**
   * Where a panel's placement is remembered — scoped to the interface that declared it.
   *
   * A drag is a fact about *this panel in this interface*, not about the panel everywhere. Keyed on
   * the dock alone, a transcript dragged while trying out one template kept that position under
   * every other one and silently outranked whatever the next template declared — which reads as the
   * declaration being ignored rather than as an older preference winning.
   *
   * An interface that declares nothing shares the unscoped key, so a panel somebody positioned in an
   * ordinary space stays where they put it: the scope exists to stop declarations being overruled by
   * unrelated history, not to make every template forget.
   */
  const placementKey = (id: string): string => {
    // An instance kept under the app keeps its place under the app — across every interface.
    if (allInstances()[APP_PANEL_SCOPE]?.[id]) return `${APP_PANEL_SCOPE}::${id}`;
    const scope = templatePanelScope();
    return scope && declarationFor()[id] ? `${scope}::${id}` : id;
  };
  /**
   * Authored panels the reader has closed, so they stay closed while the template that declared
   * them is on screen — and only while.
   *
   * ## Two things were wrong with keeping this forever
   *
   * It had one writer and no clearer, so a closed panel could never be reopened: nothing in the app
   * sets an entry back to false, and `edge:` reads `null` for a closed panel, which is how the host
   * knows to render no dock. Closing an authored panel was permanent for the session.
   *
   * And it was keyed by the bare `panel.id`, which a template chooses — so "inspector" closed in one
   * template arrived closed in the next, with no way to tell that it had. `placementKey` had already
   * met this problem for positions and answers it by scoping to the template; the same scope applies
   * here.
   *
   * Cleared on a template switch rather than persisted. A closed panel is a statement about the
   * arrangement in front of you, and the arrangement has been replaced.
   */
  const [closedPanels, setClosedPanels] = signal<Record<string, boolean>>({});

  /*
    Every interface's panel instances, kept across reloads like the reader's placements — and the
    ones on screen, published for the bodies that render them (`panelInstances`).

    Two scopes can own one screen: the interface's own, and the app's (`APP_PANEL_SCOPE`) — where an
    instance that is not about this interface lives, so it stays open across spaces. The app's
    instances merge under the interface's here, and the interface's win an id collision the way its
    declarations do everywhere else.
  */
  /*
    Whose instance records these are — injected by `SessionStore` once it knows, the way
    `spaceGate` is. Kept by DID so a logout without a reload never shows the next agent the
    last one's chats: a change of agent re-reads storage for the one now signed in.
  */
  const [didOf, setDidOf] = signal<(() => string | undefined) | undefined>(undefined);
  const agentDid = () => didOf()?.() ?? '';
  /**
   * Which dataset is on screen, asked as "is this the one" — injected by `SpaceStore`, which
   * is composed after the shell store, the same reason `moduleGate` is. An instance whose inputs bind it to
   * a dataset (the space chats) shows only while its space is current: hidden elsewhere, not
   * closed, so it is still there when you go back.
   */
  const [spaceGate, setSpaceGate] = signal<(datasetId: string) => boolean>(() => true);
  const visibleInstances = (all: Record<string, Record<string, PanelInstance>>) =>
    Object.fromEntries(
      Object.entries({
        ...(all[APP_PANEL_SCOPE] ?? {}),
        ...(all[templatePanelScope()] ?? {}),
      }).filter(
        ([, instance]) => typeof instance.inputs.datasetId !== 'string' || spaceGate()(instance.inputs.datasetId),
      ),
    );
  const [allInstances, setAllInstances] = signal(loadInstances(storage, untrack(agentDid)));
  /*
    A change of agent re-reads storage for the one now signed in. Only the agent: the instances on
    screen are published by the effect below, whatever changed them, so this one no longer publishes
    too — it did, from its own copy, and so re-read storage whenever the space gate changed as well.
  */
  let instancesFor = untrack(agentDid);
  effect(() => {
    const did = agentDid();
    if (did === instancesFor) return;
    instancesFor = did;
    untrack(() => setAllInstances(loadInstances(storage, did)));
  });
  // Following every announcement of a declaration, which is what says the interface on screen has
  // changed — the scope itself is a plain read, and the same declaration can arrive for another one.
  const instancesHere = memo(() => {
    panelsVersion();
    return visibleInstances(allInstances());
  });
  effect(() => publishPanelInstances(instancesHere()));
  const writeInstances = (
    scope: string,
    change: (here: Record<string, PanelInstance>) => Record<string, PanelInstance>,
  ) => {
    const all = untrack(allInstances);
    const here = change({ ...(all[scope] ?? {}) });
    const next = { ...all };
    if (Object.keys(here).length) next[scope] = here;
    else delete next[scope];
    saveInstances(storage, agentDid(), next);
    // Published as it is written, so a body drawn in the same breath reads its inputs.
    publishPanelInstances(visibleInstances(next));
    setAllInstances(next);
  };

  /** Home lanes' widths and folds, for every template — see `LaneState`. */
  const [lanes, setLanes] = signal<Record<string, LaneState>>(loadLanes(storage));
  const laneKey = (lane: string) => `${templatePanelScope()}::${lane}`;
  const writeLane = (lane: string, change: Partial<LaneState>) => {
    const prev = untrack(lanes);
    const key = laneKey(lane);
    const merged: LaneState = { ...prev[key], ...change };
    const cleaned = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined && value !== false),
    );
    const next = { ...prev };
    if (Object.keys(cleaned).length) next[key] = cleaned;
    else delete next[key];
    saveLanes(storage, next);
    setLanes(next);
  };
  const [customisingLayout, setCustomisingLayout] = distinctSignal(reactivity, false);

  /*
    Switching template forgets what was closed.

    Scoping the keys stops one template's decision leaking into another's; clearing on the switch is
    what stops the map growing for the life of the session, and is also the honest reading — a panel
    somebody closed in an arrangement that has been replaced is not a preference about the new one.

    The scope is a plain read, so the effect follows every announcement of a declaration
    (`panelsVersion`) and compares: it read the scope alone, which nothing re-runs, so it ran once at
    creation and a closed panel stayed closed for the whole session. An announcement for the same
    template — an edit re-declaring its panels — is not a switch, and forgets nothing.
  */
  let closedFor = templatePanelScope();
  effect(() => {
    panelsVersion();
    const scope = templatePanelScope();
    if (scope === closedFor) return;
    closedFor = scope;
    untrack(() => setClosedPanels({}));
  });
  /**
   * The dock a declaration is about, or null when it names one that is not there.
   *
   * One resolver, because there were two and they drifted the moment docks stopped being numbered:
   * `panelSupplied` learned to read `dock` and this did not, so it went on looking for
   * `<module>:0` — an id nothing has any more. The declarations still resolved to nothing, silently,
   * and every panel a template had placed fell back to the module's own opening bid. The workshop's
   * transcript and interpretation moved from the left edge to the right and nothing said why.
   */
  const dockIdFor = (panel: TemplatePanel): string | null => {
    if (!panel.module) return templatePanelDockId(panel.id);
    if (panel.dock) return `${panel.module}:${panel.dock}`;
    const docks = dockRegistry.ordered().filter((entry) => entry.moduleId === panel.module);
    return docks.length === 1 ? docks[0].id : null;
  };

  /**
   * A section's dock: a dock id as given — a module's or the host's panel at home in a lane — or a
   * template panel's id, which is how a template's own sections have always been named.
   */
  const sectionDockId = (id: string): string => (dockRegistry.get(id) ? id : templatePanelDockId(id));

  /** A declaration by the dock id it resolves to, for the placement chain to consult. */
  const declarationFor = memo(() => {
    /*
      **No `dockRegistryVersion()` here, and it must stay that way.**

      `registerHostDockStore` announces to the dock registry, and the effect that registers an
      interface's own panels calls it on every run — while reading this memo, through
      `placementKey`, for each panel it registers. Taking the announcement as a dependency therefore
      makes that effect invalidate itself: register, announce, re-run, register, until the stack
      gives out.

      Which is why it only ever happened on an interface that declares panels of its own. The read
      is inside the loop over those panels, so an interface with none never depends on this and
      never loops — the default template was fine and the workshop froze for five seconds and left
      its docks half-built.

      `dockIdFor` resolves from module definitions precisely so this memo needs nothing reactive: a
      module's docks and their names are fixed when it registers.
    */
    const byDock: Record<string, TemplatePanel> = {};
    for (const panel of declaredPanels()) {
      const id = dockIdFor(panel);
      if (id) byDock[id] = panel;
    }
    // An instance is declared as the panel it is of — its placement, its lane, its frame.
    for (const instance of Object.values(instancesHere())) {
      const declared = byDock[templatePanelDockId(instance.panel)];
      if (declared) byDock[instance.id] = declared;
    }
    return byDock;
  });

  const members: Pick<
    ShellStore,
    | 'provideSpaceGate'
    | 'provideAgentDid'
    | 'raiseDock'
    | 'panelDeclaration'
    | 'seatFront'
    | 'resetDockToLayout'
    | 'closeTemplatePanel'
    | 'closePanel'
    | 'panelInstances'
    | 'layoutDirty'
    | 'layoutNames'
    | 'activeLayout'
    | 'saveLayout'
    | 'applyLayout'
    | 'deleteLayout'
    | 'resetTemplateLayout'
    | 'laneWidth'
    | 'setLaneWidth'
    | 'collapsedLanes'
    | 'toggleLane'
    | 'setLaneCollapsed'
    | 'customisingLayout'
    | 'toggleCustomiseLayout'
  > = {
    provideSpaceGate: setSpaceGate,
    provideAgentDid: setDidOf,
    raiseDock: raise,
    panelDeclaration: (dockId) => declarationFor()[dockId],
    seatFront: (ids) => {
      if (ids.length === 0) return undefined;
      const touched = activation();
      return frontOf(ids, Object.fromEntries(ids.map((id) => [id, touched[placementKey(id)]])));
    },

    resetDockToLayout: (id) => {
      {
        const prev = untrack(placements);
        const key = placementKey(id);
        if (!prev[key]) return;
        const next = { ...prev };
        delete next[key];
        savePlacements(storage, next);
        setPlacements(next);
      }
    },

    // Keyed exactly as the panel's own `edge:` accessor keys it — one spelling, so a close and the
    // edge that answers it cannot disagree about which panel was meant.
    closeTemplatePanel: (id) => {
      const key = placementKey(templatePanelDockId(id));
      setClosedPanels({ ...untrack(closedPanels), [key]: true });
    },

    closePanel: (instance) => {
      if (!instancesHere()[instance]) return;
      const scope = allInstances()[APP_PANEL_SCOPE]?.[instance] ? APP_PANEL_SCOPE : templatePanelScope();
      const key = placementKey(instance);
      writeInstances(scope, (here) => {
        delete here[instance];
        return here;
      });
      // Its placement goes with it: an instance opened again later is a new one, where it starts.
      if (placements()[key]) {
        const { [key]: _gone, ...rest } = placements();
        setPlacements(rest);
        savePlacements(storage, rest);
      }
    },

    panelInstances: () => Object.values(instancesHere()),

    layoutDirty: () => {
      const scope = templatePanelScope();
      if (!scope) return false;
      const prefix = `${scope}::`;
      return (
        Object.keys(placements()).some((key) => key.startsWith(prefix)) ||
        Object.entries(closedPanels()).some(([key, closed]) => closed && key.startsWith(prefix)) ||
        Object.keys(lanes()).some((key) => key.startsWith(prefix))
      );
    },

    layoutNames: () => Object.keys(layouts()[templatePanelScope()] ?? {}).sort(),
    activeLayout,

    saveLayout: (name) => {
      const scope = templatePanelScope();
      const label = name.trim();
      if (!scope || !label) return;
      const prefix = `${scope}::`;
      const under = <T>(record: Record<string, T>) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
      /*
        Everything under this template's prefix, and nothing else — the same set `resetTemplateLayout`
        clears. Panels nothing declares keep the unscoped key and are left out: a layout is "how this
        interface is arranged", not "where I keep the notes panel everywhere".
      */
      const snapshot: SavedLayout = {
        placements: under(placements()),
        activation: under(activation()),
        closed: under(closedPanels()),
        lanes: under(lanes()),
      };
      {
        const prev = untrack(layouts);
        const next = { ...prev, [scope]: { ...(prev[scope] ?? {}), [label]: snapshot } };
        saveLayouts(storage, next);
        setLayouts(next);
      }
      setActiveLayout(label);
    },

    applyLayout: (name) => {
      const scope = templatePanelScope();
      const saved = layouts()[scope]?.[name];
      if (!scope || !saved) return;
      const prefix = `${scope}::`;
      const without = <T>(record: Record<string, T>) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)));
      // Replace this template's arrangement wholesale: what the layout does not mention returns to
      // the declaration, exactly as a reset would leave it.
      {
        const prev = untrack(placements);
        const next = { ...without(prev), ...saved.placements };
        savePlacements(storage, next);
        setPlacements(next);
      }
      {
        const prev = untrack(activation);
        const next = { ...without(prev), ...saved.activation };
        saveActivation(storage, next);
        // The clock has to stay ahead of anything just restored, or the next raise lands underneath.
        activationClock = Math.max(activationClock, ...Object.values(next));
        setActivation(next);
      }
      setClosedPanels({ ...without(untrack(closedPanels)), ...saved.closed });
      {
        const prev = untrack(lanes);
        const next = { ...without(prev), ...(saved.lanes ?? {}) };
        saveLanes(storage, next);
        setLanes(next);
      }
      setActiveLayout(name);
    },

    deleteLayout: (name) => {
      const scope = templatePanelScope();
      if (!scope || !layouts()[scope]?.[name]) return;
      {
        const prev = untrack(layouts);
        const { [name]: _gone, ...rest } = prev[scope] ?? {};
        const next = { ...prev, [scope]: rest };
        saveLayouts(storage, next);
        setLayouts(next);
      }
      if (activeLayout() === name) setActiveLayout('');
    },

    resetTemplateLayout: () => {
      const scope = templatePanelScope();
      if (!scope) return;
      setActiveLayout('');
      const prefix = `${scope}::`;
      /*
        Every key under this template, rather than the panels currently declared.

        A `route`-scoped declaration only names the panels of the route on screen, so iterating those
        would leave the board's transcript where it was dragged while claiming the layout had been
        reset. The prefix is what the whole arrangement is stored under.

        Panels nothing declares keep the unscoped key, so a notes panel somebody positioned in an
        ordinary space is untouched: this says "put *this template's* panels back", not "forget
        everywhere I have ever moved anything".
      */
      {
        const prev = untrack(placements);
        const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(prefix)));
        if (Object.keys(next).length !== Object.keys(prev).length) {
          savePlacements(storage, next);
          setPlacements(next);
        }
      }
      // And the panels closed under it, which is the half `resetDockToLayout` cannot reach — a closed
      // panel has no titlebar, so its own menu is not on screen to be opened.
      setClosedPanels(
        Object.fromEntries(Object.entries(untrack(closedPanels)).filter(([key]) => !key.startsWith(prefix))),
      );
      // And the home lanes: back to the widths the template gave them, none of them folded.
      {
        const prev = untrack(lanes);
        const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(prefix)));
        if (Object.keys(next).length !== Object.keys(prev).length) {
          saveLanes(storage, next);
          setLanes(next);
        }
      }
    },

    laneWidth: (lane) => lanes()[laneKey(lane)]?.width,
    setLaneWidth: (lane, width) => {
      if (!Number.isFinite(width) || width <= 0) return;
      writeLane(lane, { width: Math.round(width) });
    },
    collapsedLanes: () => {
      const prefix = `${templatePanelScope()}::`;
      return Object.entries(lanes())
        .filter(([key, state]) => key.startsWith(prefix) && state.collapsed)
        .map(([key]) => key.slice(prefix.length));
    },
    toggleLane: (lane) => writeLane(lane, { collapsed: !lanes()[laneKey(lane)]?.collapsed }),
    setLaneCollapsed: (lane, collapsed) => writeLane(lane, { collapsed: !!collapsed }),
    customisingLayout,
    toggleCustomiseLayout: () => setCustomisingLayout(!untrack(customisingLayout)),
  };
  return {
    members,
    activation,
    closedPanels,
    declarationFor,
    declaredPanels,
    dockIdFor,
    instancesHere,
    placementKey,
    placements,
    raise,
    sectionDockId,
    setClosedPanels,
    writeInstances,
    writePlacement,
  };
}

export type ShellArrangement = ReturnType<typeof createShellArrangement>;
