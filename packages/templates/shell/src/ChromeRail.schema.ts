/**
 * The chrome rail — one edge, holding everything the host puts on screen permanently.
 *
 * ## Why the host owns this
 *
 * The first two modules to need an entry point each invented their own: notes put a tab at the right
 * edge, calls put a pill in a corner. Both worked in isolation and looked like an accident together,
 * and a third module would have made it three. A module knows what its launcher *means*; only the
 * host knows where launchers go and can keep them from colliding.
 *
 * So a module declares `launcher: { icon, label, action }` and contributes no chrome for it. This
 * renders them all, in registration order with the same id tiebreak the slot registry uses, so the
 * rail cannot reshuffle depending on which module loaded first.
 *
 * ## Why it is no longer only about modules
 *
 * It never quite was — it has carried the way into a space's settings for as long as it has existed,
 * because that is where a module gets turned back on, and those settings are a panel on this edge
 * like any module's. It now also carries the template and theme pickers, which used to be a strip of
 * chips pinned to the top-right corner.
 *
 * Those chips were the one piece of persistent chrome no layout calculation knew about: `SIDEBAR_PX`
 * reserves the left edge and `contentInset` moves content out of a docked panel's way, but nothing
 * reserved the band across the top, so every template drew its own header into space the app believed
 * was free. Two pieces of chrome in two corners also meant two things to dodge; one rail is one.
 *
 * ## Why the right edge
 *
 * It is the emptiest edge in WE's layout: the sidebar owns the left and the call bar owns the bottom
 * centre. A docked module panel takes that edge outright and slides the rail inwards by its width, so
 * the rail stays reachable while a panel is open rather than being covered by it — and the panel is
 * not stranded in the middle of the edge with chrome on both sides.
 *
 * The editor's panels take the same edge and get the same treatment, through the same variable: they
 * are docks themselves now, so opening one slides this rail exactly as opening a notes panel does.
 *
 * ## What is gated on what
 *
 * Module enablement is per-space, so outside a space there is nothing to list — `moduleLaunchers`
 * would be showing whatever the last space happened to enable — and there is no space to open
 * settings for. Both of those keep their gate.
 *
 * The design pickers do not. Which template you are looking at is a question with an answer on the
 * spaces list too, and the chips could be reached there; gating the whole rail on a current dataset
 * would have quietly removed that.
 */
import type { SchemaNode } from '@we/schema-shared';
import { railButton } from '@we/template-kit';

import { TEMPLATE_PICKER_OPEN, templatePicker, THEME_PICKER_OPEN, themePicker } from './DesignControls';

/**
 * The width every docked module panel should clear. Exported so panels stay in step with the rail.
 *
 * Derived, not chosen: a `md` square button is 40px and the rail pads it by `200` (8px) a side.
 * Change either and this has to move with it, or the buttons overflow a rail too narrow to hold them.
 */
export const CHROME_RAIL_WIDTH = '56px';

/**
 * Settings for the space you are standing in, one click away.
 *
 * Opens a **panel**, like every launcher above it. It used to open the global settings overlay and
 * navigate, inside that overlay's router, to the page for the current space — which meant a button
 * labelled "Space settings" produced a full-window surface headed "Settings" with an Account /
 * Appearance / Spaces & data nav down its side, and took the space off the screen while you
 * configured it. See `SpaceSettingsPanel.schema.ts` for the rest of that argument.
 *
 * That also makes this button consistent with the rest of the rail rather than the exception in it:
 * every other row here toggles a panel and lights up while it is open, and this one now does too.
 *
 * Outside the launcher list on purpose: it renders even when no module does. Gating it on having
 * launchers would remove the way back to the module settings in exactly the state — everything
 * turned off — where someone needs it.
 */
const spaceSettingsLauncher: SchemaNode = railButton({
  icon: 'gear',
  tooltip: 'Space settings',
  // Lit while its panel is up, exactly as a module launcher is — see `activeWhen` on those.
  active: { $: 'shellStore.spaceSettingsOpen' },
  onClick: { $action: 'shellStore.toggleSpaceSettings' },
});

/**
 * The launchers, and the way into the settings that turn them on. Only inside a space.
 *
 * Wrapped as one section rather than gated individually so the divider below it can be gated on the
 * same answer — an empty rail with a stray horizontal line in it was the shape this took the first
 * time the two were gated apart.
 */
const spaceSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'datasetStore.currentDataset' },
    then: {
      type: 'Column',
      props: { gap: '100', ay: 'center', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'spaceStore.moduleLaunchers' }, as: 'mod' },
          children: [
            railButton({
              icon: { $: 'mod.icon' },
              tooltip: { $: 'mod.label' },
              // Highlighted while the module reports itself open, which is what makes the rail read
              // as a set of tabs rather than a row of buttons.
              active: { $: 'mod.active' },
              // The id is passed rather than a path: `$action` resolves a literal string, so a rail
              // iterating over modules cannot build `modules.<id>.<method>` itself.
              onClick: { $action: 'spaceStore.launchModule', args: [{ $: 'mod.id' }] },
            }),
          ],
        },
        // Separated from the launchers only when there are some to separate from.
        {
          type: '$if',
          props: {
            condition: { $: 'count(spaceStore.moduleLaunchers)' },
            then: { type: 'we-divider', props: { width: '100%', my: '100' } },
          },
        },
        spaceSettingsLauncher,
        { type: 'we-divider', props: { width: '100%', my: '100' } },
      ],
    },
  },
};

/**
 * The template and theme pickers.
 *
 * Hidden while an external app or a shell overlay is up, which is the rule the chips they replace
 * followed: both of those cover the template, so a control for choosing which template is underneath
 * is offering to change something you cannot see.
 */
const designSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: '!appStore.activeAppId && !shellStore.activeShellView' },
    then: {
      type: 'Column',
      props: { gap: '100', ay: 'center', width: '100%' },
      // Both flags live here, above either picker, so opening one can close the other. Held by the
      // thing that knows they are a set — neither picker can see the other's state.
      $localState: {
        [TEMPLATE_PICKER_OPEN]: { type: 'boolean', initial: false },
        [THEME_PICKER_OPEN]: { type: 'boolean', initial: false },
      },
      children: [themePicker(), templatePicker()],
    },
  },
};

export const chromeRail: SchemaNode = {
  type: '$if',
  props: {
    // Nothing here means anything before the app is up, and the boot screen owns the whole window.
    condition: { $: "sessionStore.bootState == 'ready'" },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        /*
          Against the content's edge rather than the window's, so chrome that takes this edge slides
          the rail inwards instead of opening on top of it.

          One term, where there were two. The editor's panels used to publish a width of their own
          (`--we-editor-right`) because they positioned themselves; they are docks now, so they are
          inside `--we-chrome-right` along with every module's panel — and a panel dragged away from
          this edge stops pushing the rail at all, which the summed version could not express.

          Note the rail does not clear `--we-chrome-rail-width`, and must not: that variable is this
          rail's own width, published for the chrome that sits *outside* it.
        */
        right: 'var(--we-chrome-right, 0px)',
        /*
          Below whatever a panel is doing at the top, and below the app's own floating chrome.

          Two terms, for two different collisions. `--we-chrome-top` is a panel that has *taken* the
          top edge, which this would otherwise sit inside — the vertical twin of the
          `--we-chrome-right` term above, and the same fix. `--we-panel-chrome-top` is chrome a
          module has declared at the top, which this rail can be walked into by a wide enough panel;
          the shell publishes it as zero when there is nothing up there, so nothing moves for
          nothing.

          A maximised panel is not among the collisions, and briefly was: this used to drop below its
          titlebar so it stayed reachable over the top of one. The rail hides instead — see `styles`
          below — because full screen means the app's own furniture is gone.

          The band is this rail's alone, which is why it is not folded into `--we-chrome-top`: every
          other piece of chrome is painted *below* the panels and so has nothing to dodge, and one
          that cleared 98px whenever any panel anywhere was open would be dodging nothing visible.
        */
        top: 'calc(16px + var(--we-panel-chrome-top, 0px) + var(--we-chrome-top, 0px))',
        width: CHROME_RAIL_WIDTH,
        gap: '100',
        p: '200',
        ay: 'center',
        /*
          Page-toned, and lifted by the border and the shadow rather than by tone.

          `surface-raised` looks like the role for this — the docs even name "a docked rail with a
          shadow" — and it is the wrong one, because it belongs to the *tonal ladder*: the sequence
          page → card → popover, where each step is read against the one it covers. A popover has to
          clear the card underneath it, so the role lifts a full 10 lightness points. This rail
          covers nothing. It sits on the page, with air on both sides, and taking a ladder rung
          meant for occluding a card painted it 11 points lighter than everything around it — the
          washed-out grey strip that prompted this.

          Chrome is separated by *edge*, not by tone, which is what the border and the shadow are
          doing here and why the rail still reads as floating without them being redundant. It is
          also what this rail always did (`neutral-50`, the page step), and the same choice the
          hover-rail pattern in the schema docs makes.

          The call bar in @we/module-call does the same thing for the same reason; keep the two in
          step. A genuinely occluding surface — a menu, a select dropdown — still wants
          `surface-raised`, and that is the distinction the two are now on opposite sides of.
        */
        bg: 'page',
        border: '1px solid border',
        rtl: '400',
        rbl: '400',
        shadow: 'md',
        zIndex: 'sticky',
        /*
          Out of the way entirely while a panel is maximised.

          It shares the panels' layer and wins on document order — it is registered after them at the
          same anchor — so a full-screen panel would otherwise have this printed down its right edge,
          over the position menu and the un-maximise button that recover it. Hidden rather than
          dropped below the titlebar, which was the first answer: full screen means the app's own
          furniture is gone, and the way back is the panel's titlebar and the Escape key.
        */
        styles: { $: "shellStore.panelMaximised ? { display: 'none' } : null" },
        transition: 'right var(--we-chrome-transition, 300ms) ease, top var(--we-chrome-transition, 300ms) ease',
      },
      children: [spaceSection, designSection],
    },
  },
};
