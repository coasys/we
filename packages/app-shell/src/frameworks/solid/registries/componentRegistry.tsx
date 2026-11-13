/*
  Defines the custom elements the seed's `elements` names — a library's chart, a rating. Imported
  beside the vocabulary a template renders against, because that is what these tags join: the
  renderer mounts any hyphenated tag already, and without this import one would mount as an empty
  element nothing ever upgrades.
*/
import '@shared/registries/foreignElements.generated';

import {
  AudioDisplay,
  BlockComposer,
  BlockRenderer,
  CalloutDisplay,
  CodeDisplay,
  EmbedDisplay,
  EventDisplay,
  FileDisplay,
  ImageDisplay,
  LinkDisplay,
  LocationDisplay,
  TagDisplay,
  TaskDisplay,
  VideoDisplay,
} from '@we/block-solid';
import {
  AvatarStack,
  Calendar,
  Canvas,
  Card,
  CodeEditor, // Plainly, though it carries CodeMirror — see the registry entry below.
  CollapsedContent,
  Column,
  Combobox,
  CountMark,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  ImageLightbox,
  RerenderLog,
  Row,
  Search,
  Select,
  SignalControl,
  ToastContainer,
} from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import { lazy } from 'solid-js';

import CredentialField from '../components/CredentialField';

/**
 * Components fetched when something first renders them, rather than before anything renders at all.
 *
 * Each of these carries a dependency far larger than the app around it, and each serves a mode most
 * sessions never enter. Loading them eagerly put that weight in front of first paint for everyone.
 *
 * This is code-splitting inside one build, not loading separately-built bundles: Rollup still gives
 * every chunk the same `solid-js`, so the single-instance guarantee the module system depends on is
 * untouched — see the note in `bundledModules.ts`, which is about the other thing.
 *
 * **Module components are not here.** `CesiumGlobe` and `GraphView` arrive through the module
 * registry — `registerModuleComponents` below adds whatever the registered modules contribute — so
 * that what a template may name and which module provides it are one list. See `moduleComponents.tsx`.
 */

/*
  The body of a panel an interface declared, rendered with the interface's own grants.

  Registered as a component rather than inlined into the frame because that is what a bag switch
  needs: `RenderSchema` takes a bag per call site, and a component is the only thing that can make a
  second call from inside one tree. See `shared/registries/templateBag.ts`.
*/
const TemplatePanelBodyOnDemand = lazy(() => import('../components/TemplatePanelBody'));
// Where a place shows a panel the panel host draws once — see `PanelHost`.
const PanelSlotOnDemand = lazy(() => import('../components/PanelHost'));

/*
  A `$panels` outlet — a lane in the template's own flow. The marker is rewritten to this name by
  `resolveParts` before the renderer sees it, the way `$part` is expanded, because it has to read the
  shell's placements and render sections with the template's bag, which only a host component can.
*/
const PanelLaneOnDemand = lazy(() => import('../components/PanelLane'));

/*
  Where a module's part is placed — the part, or what stands in for it when its module is not here.
  `resolveParts` wraps every `$part` in one; see `PartFrame.tsx`.
*/
const PartFrameOnDemand = lazy(() => import('../components/PartFrame'));

/** One decorative component, and `three` behind it. */
const WeCubeOnDemand = lazy(() => import('../components/3d/WeCube'));

/** The editing surface — CodeMirror and Prism arrive with it, once a template is being edited. */
const EditingBar = lazy(() => import('@we/editor').then((m) => ({ default: m.EditingBar })));
const TemplateCard = lazy(() => import('@we/editor').then((m) => ({ default: m.TemplateCard })));
const AiPanel = lazy(() => import('@we/editor/ai').then((m) => ({ default: m.AiPanel })));

/*
  The AI chat, and the sheet it becomes on a phone. One body (`AgentChat`) behind the global panel,
  the space's floating window and the sheet — `AgentChatSheet` only hosts it when a narrow window
  asks. Host-only: a template declares the panels (`chat-global`/`chat-space`), it does not name
  the body.
*/
const AgentChatOnDemand = lazy(() => import('../components/chat/AgentChat'));
const AgentChatSheetOnDemand = lazy(() => import('../components/chat/AgentChatSheet'));
/*
  One entry per editor panel, because each is its own dock now.

  They arrived as a single `RightPanelContainer` when the editor owned its own rails, widths and
  position at the right edge. The shell places them now — the same grip, snap targets, resize and
  maximise every other panel has — so what it needs from this package is the contents of each, named
  separately so a dock's node can say which one it holds.
*/
const EditorCodePanel = lazy(() => import('@we/editor').then((m) => ({ default: m.CodePanel })));
const EditorInspectorPanel = lazy(() => import('@we/editor').then((m) => ({ default: m.InspectorPanel })));
const EditorThemePanel = lazy(() => import('@we/editor').then((m) => ({ default: m.ThemePanel })));

export const componentRegistry: ComponentRegistry = {
  // @we/components
  AvatarStack,
  Calendar,
  Canvas,
  Card,
  /*
    A read-only code view, and CodeMirror behind it.

    Registered because the generated component reference already documents `CodeEditor` as available
    to schemas, and it was not — so a schema reaching for it rendered nothing at all, silently. The
    docs promised it; this makes the promise true.

    NOT `lazy()`, though it is the largest thing here. It was, and the wrapper was inert:
    `@we/components` builds with `splitting: false`, so `@we/components/solid` is a single module —
    and this file, along with a dozen others in the shell, already imports it statically for `Column`
    and `Row`. Rollup said so on every app build (INEFFECTIVE_DYNAMIC_IMPORT) and split nothing.

    Nothing moves by dropping it: `CodeEditor` fetches CodeMirror itself, in `onMount`, so the
    ~270 KB stays out of the eager graph either way. The deferral belongs in the component, which is
    the only place it survives a consumer that also wants a `Column`.
  */
  CodeEditor,
  CollapsedContent,
  Column,
  Combobox,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  /*
    The viewer a picture in a post opens into — `ImageDisplay` mounts it directly. Registered so a
    template opening an image does not grow a second one: a relation's photos in the inspector and on
    the record page open here too.
  */
  ImageLightbox,
  Row,
  Search,
  Select,
  ToastContainer,

  // @we/editor
  AiPanel,
  EditorCodePanel,
  EditorInspectorPanel,
  EditorThemePanel,
  // Host-only: a template names panels, never this. It is what a panel's *frame* wraps around the
  // template's node so the two can be rendered with different grants.
  TemplatePanelBody: TemplatePanelBodyOnDemand,
  PanelSlot: PanelSlotOnDemand,
  /*
    The password field, which a sign-in screen places and cannot replace or read. Eager: it is on
    the first screen anybody sees. See `CredentialField.tsx`.
  */
  CredentialField,
  // Host-only for the same reason: a template writes `$panels`, never this.
  PanelLane: PanelLaneOnDemand,
  // Host-only: a template writes `$part`, never this.
  PartFrame: PartFrameOnDemand,
  SignalControl,
  CountMark,

  // @we/block-solid
  BlockComposer,
  BlockRenderer,
  AudioDisplay,
  CalloutDisplay,
  CodeDisplay,
  EmbedDisplay,
  EventDisplay,
  FileDisplay,
  ImageDisplay,
  LinkDisplay,
  LocationDisplay,
  TagDisplay,
  TaskDisplay,
  VideoDisplay,

  // Marketplace
  TemplateCard,

  // Shell
  EditingBar,

  /*
    Testing.

    A perf debugging tool — logging on every mount is its purpose, which is exactly why production
    templates should not be able to reach it.

    Build-gated rather than gated on `sessionStore.devTools`, and deliberately not moved onto that
    switch with the rest of the developer affordances. The switch governs what *chrome* shows; this
    is a word in the vocabulary a template is rendered against, and the registry is built once. A
    template naming an unregistered component renders nothing and warns, which is the right answer
    for a production build and the wrong one for a developer who has merely muted their own tools.
  */
  ...(import.meta.env.DEV ? { RerenderLog } : {}),

  // 3D
  WeCube: WeCubeOnDemand,
};

/**
 * The registry host-authored schema renders against — the template's, plus the pieces a template
 * must never mount itself.
 *
 * The AI chats are the reason this exists. `AgentChat` reaches the executor's sessions and sends
 * real questions, so it may be named only where the host controls the tree — the app's own schema,
 * shell overlays and panel frames — never inside a space template's, where a synced interface
 * could put it anywhere and drive it through `panel.inputs` it chooses. A template renders against
 * `componentRegistry`, which simply does not know the name: it is absent rather than refused, the
 * same answer every unregistered component gets.
 *
 * Panels declared by the *app* template do render `AgentChat` — they are how the chats exist at
 * all. `TemplatePanelBody` picks this registry for those declarations alone, by whether the panel
 * object is one of the app's own rather than by anything the interface can say about itself.
 */
export const chromeComponentRegistry: ComponentRegistry = {
  ...componentRegistry,
  AgentChat: AgentChatOnDemand,
  AgentChatSheet: AgentChatSheetOnDemand,
};

/**
 * Add what the registered modules contribute to the registry a template renders against.
 *
 * Called once at boot, after the seed's modules have registered and before anything renders. The
 * registry is a plain object read at render, so adding to it here is enough; a module registered
 * later — a test, a hot reload — calls this again. A module's component never overrides a host one:
 * the host's vocabulary is the one templates were written against, and a module shadowing `Column`
 * would break every template at once.
 */
export function registerModuleComponents(contributed: Record<string, unknown>): void {
  for (const [name, component] of Object.entries(contributed)) {
    /*
      Checked against the chrome registry — the superset — so a module cannot name `AgentChat`
      either: that is the host's component, and shadowing it there would make the template
      registry's absence of it meaningless.
    */
    if (name in chromeComponentRegistry && chromeComponentRegistry[name] !== component) {
      console.warn(`module component "${name}" would shadow a host component and was not registered`);
      continue;
    }
    (componentRegistry as Record<string, unknown>)[name] = component;
    (chromeComponentRegistry as Record<string, unknown>)[name] = component;
  }
}
