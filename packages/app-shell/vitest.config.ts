import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Mirror tsconfig's path aliases for source files imported through the test graph.
const alias = { '@shared': r('./src/shared'), '@solid': r('./src/frameworks/solid') };

/*
  Store tests: each store under both reactivity ports, with the platform port's test implementation
  standing in for the window. No DOM, so a store reaching for a browser global fails here rather
  than passing on jsdom's. The browser build of solid-js all the same (the node build's effects never
  run again), inlined so Node's own resolution does not hand back the server build.
*/
const STORE_TESTS = [
  'tests/accountStore.test.ts',
  'tests/appStore.test.ts',
  'tests/canvasHistory.test.ts',
  'tests/chatStoreOpen.test.ts',
  'tests/clockStore.test.ts',
  'tests/datasetIdentity.test.ts',
  'tests/datasetStore.test.ts',
  'tests/distinctSignal.test.ts',
  'tests/dockStowAndReveal.test.ts',
  'tests/editTarget.test.ts',
  'tests/editorStore.test.ts',
  'tests/followLive.test.ts',
  'tests/identityStore.test.ts',
  'tests/interpretationStore.test.ts',
  'tests/keyedSignals.test.ts',
  'tests/libraryFlow.test.ts',
  'tests/liveTemplate.test.ts',
  'tests/profileIndex.test.ts',
  'tests/profileStore.test.ts',
  'tests/recordCanvas.test.ts',
  'tests/recordConnections.test.ts',
  'tests/recordDrops.test.ts',
  'tests/recordForms.test.ts',
  'tests/recordKinds.test.ts',
  'tests/recordStoreComposition.test.ts',
  'tests/recordTree.test.ts',
  'tests/routeStore.test.ts',
  'tests/sessionStore.test.ts',
  'tests/shapeStore.test.ts',
  'tests/shellArrangement.test.ts',
  'tests/shellDockDrag.test.ts',
  'tests/shellDocks.test.ts',
  'tests/shellPathMemory.test.ts',
  'tests/shellPrompts.test.ts',
  'tests/shellStoreComposition.test.ts',
  'tests/shellTemplatePanels.test.ts',
  'tests/shellViews.test.ts',
  'tests/spaceContent.test.ts',
  'tests/spaceDetails.test.ts',
  'tests/spaceExtraction.test.ts',
  'tests/spaceInvolvements.test.ts',
  'tests/spaceList.test.ts',
  'tests/spaceModules.test.ts',
  'tests/spaceNavigation.test.ts',
  'tests/spaceRecordWait.test.ts',
  'tests/spaceRolesPart.test.ts',
  'tests/spaceStoreComposition.test.ts',
  'tests/spaceTaskStates.test.ts',
  'tests/spaceTemplateChoosing.test.ts',
  'tests/spaceUnread.test.ts',
  'tests/spaceWrites.test.ts',
  'tests/templateDrafts.test.ts',
  'tests/templateStoreSpaceSwitch.test.ts',
  'tests/treeRelation.test.ts',
  'tests/treeUndo.test.ts',
  'tests/vueReactivity.test.ts',
  'tests/workflowStore.test.ts',
];

/*
  The stores in a React tree, through a test-only binding (`tests/react/useStore.ts`): what a second
  host's binding costs. jsdom for react-dom, the browser build of solid-js for the Solid engine, and
  no Solid transform — the files are plain TypeScript.
*/
const REACT_TESTS = ['tests/react/**/*.test.ts'];

// Tests that mount real Solid components/providers — they need jsdom, browser resolve
// conditions, and the solid transform. Everything else stays in the plain node project.
const SOLID_TESTS = [
  // Renders the template root through the real part expansion and edits it live.
  'tests/liveSchema.test.tsx',
  // Mounts a part's frame and changes its subject under it: real Solid effects and cleanups.
  'tests/partWhileShown.test.tsx',
  'tests/executorFreeBoot.test.tsx',
  /*
    Store tests that still need a DOM. Each store is on the platform port; what these reach is not:
    runtime, presence, bundle and template stores import modules outside shared/stores (safe mode,
    the boot snapshot, the device's app) that read storage themselves; the theme store's CSS goes
    through the sanitiser, which parses it with the browser's own CSS parser. The overlay router's test is about the window's history
    being left alone, so the window is its subject.
  */
  'tests/runtimeStore.test.ts',
  'tests/presenceStore.test.ts',
  'tests/bundleStore.test.ts',
  'tests/themeStore.test.ts',
  'tests/templateStore.test.ts',
  'tests/shellRouteStore.test.ts',
  'tests/shellRouterRoot.test.tsx',
  // Hands the settings opener a real click, which only a DOM can make.
  'tests/spaceSettingsTab.test.ts',
  // Draws an editor edit through the real renderer and counts which components mount again.
  'tests/editorRedraw.test.tsx',
  'tests/shellOverlayRemount.test.tsx',
  // Not a component test, but it drives real `we-iframe` elements with shadow roots and real
  // `MessageEvent`s — the DOM is what is under test.
  'tests/appBridge.test.ts',
  // Reads a served `index.html` with `DOMParser`, dispatches real `vite:preloadError` events at a
  // real `window` and drives `visibilitychange` on a real `document` — the DOM is the subject.
  'tests/buildFreshness.test.ts',
  // Nothing renders, but the whole point is the fallback path: a real `document`, a real textarea
  // appended and removed, and `navigator.clipboard` absent the way it is outside a secure context.
  'tests/copyText.test.ts',
  'tests/templateBoundary.test.tsx',
  // Imports the shell's own schemas, which reach Solid modules that refuse to load outside a
  // browser environment. Nothing here renders — the DOM is a condition of the import, not the test.
  'tests/tierFit.test.ts',
  // Renders a card's faces through the real renderer, components and host functions.
  'tests/cardPeopleLive.test.tsx',
  // Renders a route through the real router and renderer, reading the surface its layout provides.
  'tests/routeSurface.test.tsx',
  // Mounts a thread through the real fragment and renderer, watching which drill-downs it issues.
  'tests/threadDepth.test.tsx',
  'tests/homeLaneState.test.tsx',
  // A lane holding any panel: renders the shell store's real reactivity, so the node build would not do.
  'tests/laneSections.test.tsx',
  'tests/edgeLanes.test.tsx',
  'tests/panelInstances.test.tsx',
  // Mounts the chat twice over the issued nonce — only the browser build's effects reach the
  // store's pending map, and a spent nonce must send nothing the second time.
  'tests/agentChatDraft.test.tsx',
  // The conversation list opens from a real button — what a keyboard reaches is DOM, not a flag.
  'tests/agentChatList.test.tsx',
  // Send-again, the Enter guards, draft restore, refresh clearing, and the remembered conversation
  // are all reads on the mounted chat — they need the browser build's event dispatch and effects.
  'tests/agentChatResend.test.tsx',
  // The refusal card rendered — the sentence and the folded error are DOM, not derivations.
  'tests/agentChatRefusal.test.tsx',
  // Mounts the chat to press Send and Enter into one pending create, and to watch the composer
  // after a failed first send — real event dispatch and the browser build's reactivity.
  'tests/agentChatSend.test.tsx',
  // Mounts trees through the real renderer to say which registry a template may not reach.
  'tests/chatTrustBoundary.test.tsx',
  // A template's openPanel aimed at the app's chat panels: the real store, the real declarations,
  // the real bag, and the real panel host between the call and a mounted AgentChat.
  'tests/appPanelBoundary.test.tsx',
  // The sheet is a dialog: focus moves in and is trapped, Escape closes, drag cancels clean.
  'tests/agentChatSheet.test.tsx',
  // The subject is the mount itself: the body element must stay the same node while other panel
  // records come and go — only the browser build tracks the per-id memo finely enough to prove it.
  'tests/panelBodyRemount.test.tsx',
  // A panel drawn once and moved between places: needs the browser build's reactivity, as the lanes do.
  'tests/panelHost.test.tsx',
  // Mounts the real RecordStore over a stand-in data layer to drive a canvas's undo round trip.
  'tests/canvasHistory.test.tsx',
  // The same, for a card dragged to another place in a tree.
  'tests/treeUndo.test.tsx',
  // And for a drag on a tree whose spine is a model relation rather than a connection kind.
  'tests/treeRelation.test.tsx',
  // Mounts a card's reaction mark and presses it.
  'tests/reactionBadge.test.tsx',
  // Types into the host's password field through real primitives and watches where the value goes.
  'tests/credentialField.test.tsx',
  // Safe mode reads the address, both storages and keys on a real window.
  'tests/safeMode.test.ts',
  // Nothing renders, but every case measures a real element's box and reads real attributes off a
  // real tree — the DOM is the subject, and the frame maths is what a live cursor is right or
  // silently wrong by.
  'tests/liveView.test.ts',
  // Drives real Solid effects, which is the whole subject: the failure is what a framework does with
  // an effect whose first run tracked nothing, and the node project's SSR build never re-runs one.
  'tests/moduleServiceBinding.test.ts',
  // Builds a module's store against a real reactive graph. The module package's own tests use the
  // one-shot effect, which cannot reproduce an effect that re-triggers itself — the bug that froze the
  // app before login.
  'tests/liveStoreReactive.test.tsx',
  // Mounts the real router, because the failure was what it matches, not what the table holds.
  'tests/spaceDeepLink.test.tsx',
  // The real router, buildRoutes and the renderer together: where a template's links go.
  'tests/templateNavigation.test.tsx',
  // Drives the create-space modal's schema through the real renderer: what reaches createSpace.
  'tests/createSpaceServer.test.tsx',
  // The AI settings schema through the real renderer: what an install's progress re-renders.
  'tests/localAiProgressRender.test.tsx',
];

export default defineConfig({
  /*
    Tests run as a build with developer features, so a test that walks every bundled template walks
    the ones marked `dev` too. Without it they would be left out of the registry here, and checks
    over "every template" would quietly pass over four of them. See `devFeatures.ts` in
    `@we/module-shared`; `devOnlyTemplates.test.ts` builds for production itself.
  */
  define: { __WE_DEV_FEATURES__: 'true' },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './.coverage',
      /*
        Everything under `src`, whether a test loaded it or not.

        Without an `include`, v8 reports only the files the run actually imported — so a store no
        test touches is not 0%, it is *absent*, and the percentage is computed over the half that
        happens to be covered. Seven of seventeen stores were missing from the report entirely and
        the figure read 49% of the ten that were there, which is a number about a subset nobody
        chose. Listing the whole tree makes an untested file count as the zero it is.

        The point of the change is that the number stops flattering. `src/frameworks/**` used to be
        excluded outright — all 9,380 lines of the stores — for the same reason and with the same
        effect.
      */
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/node_modules/**', 'tests/**', 'src/**/index.ts', 'src/seed/cli.ts', 'src/seed/examples.ts'],
      /*
        Still no threshold, deliberately. A gate set to today's number ratchets only by accident,
        and the first honest reading is the input to deciding what to test rather than a line to
        defend. What was missing was not a threshold — it was a number that meant anything.
      */
    },
    projects: [
      {
        test: {
          name: 'node',
          alias,
          globals: true,
          include: ['tests/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/reactivitySeed.ts'],
          exclude: ['**/node_modules/**', ...SOLID_TESTS, ...STORE_TESTS, ...REACT_TESTS],
        },
      },
      {
        resolve: { conditions: ['development', 'browser'] },
        ssr: { resolve: { conditions: ['development', 'browser'], externalConditions: ['development', 'browser'] } },
        test: {
          name: 'stores',
          alias,
          globals: true,
          environment: 'node',
          include: STORE_TESTS,
          setupFiles: ['./tests/reactivitySeed.ts'],
          server: { deps: { inline: [/solid-js/] } },
        },
      },
      {
        resolve: { conditions: ['development', 'browser'] },
        test: {
          name: 'react',
          alias,
          globals: true,
          environment: 'jsdom',
          include: REACT_TESTS,
          setupFiles: ['./tests/reactivitySeed.ts'],
          server: { deps: { inline: [/solid-js/] } },
        },
      },
      {
        plugins: [solidPlugin()],
        resolve: {
          // A single solid-js instance across transformed source and prebuilt dists.
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
          conditions: ['development', 'browser'],
        },
        test: {
          name: 'solid',
          alias,
          globals: true,
          environment: 'jsdom',
          // Observers jsdom lacks — see the file. Only this project needs them: it is the one that
          // renders components, and a component that measures itself reaches for them on mount.
          setupFiles: ['./tests/jsdomGaps.ts', './tests/reactivitySeed.ts'],
          include: SOLID_TESTS,
        },
      },
    ],
  },
});
