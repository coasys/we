# Interpretation

Interpretation is a pass of the backend's language model over one conversation (a `CollectionBlock` and its children), which proposes typed records, for example tasks, from what was said. The `interpretation` kernel gives a module this capability for the space it runs in. The transcribe and feed modules use it.

**Why:** A standing watch over a conversation is a registration in the dataset that outlives the module that asked for it, and peers share it. So the kernel has no `watch`. A module names a collection with `watchCollection` and holds nothing, and the host keeps the watch (`interpretation.ts` header). For the same reason, the readout of running passes is a host store (`InterpretationStore`), and not module state: a pass continues after the panel that started it closes (`InterpretationStore.tsx` header).

**Parent:** [Transcription](README.md)

<details><summary>How it works</summary>

**The kernel** (`InterpretationKernel`):

| Group | Members |
|---|---|
| Can it run | `available` (the node has a model), `autoEnabled(collectionId?)` (the space or the call decided to interpret as the conversation grows) |
| Group decisions for one call | `setAuto`, `targets` (one row per model, ticked when on), `targetsLoaded`, `setTarget` |
| Passes | `runOnCollection`, `watchCollection`, `unwatchCollection`, `reconcileCollection`, `passSettled` |
| Readout | `activity` (this agent's and the peers' passes, as strings for a schema), `proposalsRevision` |
| Review | `proposals`, `accept`, `reject` (a whole record or one property), `connections` |

**The host side.** `interpretationRuntime` (owned by `SpaceStore`) gathers the turns (`gatherTranscriptTurns`), runs the pass, and files the results with relations of the collection:
- `runs`: a `ModelRun` with `kind: 'extraction'` for each pass.
- `extracted`: a record that a model proposed from the conversation. It is also a child, so the call's board shows it.
- `recognised`: a record that a pass matched and did not make.

A record that a model wrote has `generatedBy` set to its run, in the same write. `passSettled` reconciles the collection, and then makes sure the collection has a board (`ensureBoardFor`). Calls for one collection are coalesced.

`InterpretationStore` joins the backend's report of this node's passes, the peers' reports from the relay, and the profiles, into the `activity` list. The transcribe module's interpretation panel uses `busyWhen: 'passRunning'`, so the rail shows that a pass runs.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/interpretation.ts](../../../../packages/module-system/shared/src/interpretation.ts): `InterpretationKernel`, `InterpretationActivitySummary`.
- [packages/app-shell/src/frameworks/solid/stores/space/interpretationRuntime.ts](../../../../packages/app-shell/src/frameworks/solid/stores/space/interpretationRuntime.ts): passes, watches, the `runs` / `extracted` / `recognised` relations.
- [packages/app-shell/src/frameworks/solid/stores/InterpretationStore.tsx](../../../../packages/app-shell/src/frameworks/solid/stores/InterpretationStore.tsx): the `activity` readout.
- [packages/app-shell/src/shared/interpretation/](../../../../packages/app-shell/src/shared/interpretation): `transcriptTurns.ts`, `activityView.ts`, `callExport.ts`.
- [packages/app-shell/src/shared/registries/moduleHostServices.ts](../../../../packages/app-shell/src/shared/registries/moduleHostServices.ts): the kernel built from the host's services, and `passSettled`.
- The backend's interpretation port and boards are in the [Data](../../../data/README.md) branch.

</details>
