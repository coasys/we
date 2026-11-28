# Glossary

This file defines each term that WE uses in its own way, once, in alphabetical order. Each entry gives the term, its code names in brackets, the definition, one usage example, and the page that owns the term. "not: …" lists words that pages must not use for the term. A word is on a "not:" list only when it never names anything else in the repository. General technical terms and external products keep their usual meaning and have no entry, such as JSON, SolidJS, Lit, web component, custom element, CSS variable, ProseMirror, Yjs, Electron, Tauri, Vite, WebRTC, SFU and MCP. AD4M terms that WE uses in their AD4M meaning have no entry either, such as executor, agent, DID, perspective, neighbourhood, link, AD4M expression, language, Social DNA, SHACL and `Ad4mModel`. An entry states only what is specific to WE.

**Account** (`Account`, `AccountHost`, `AccountStore`, `PlatformAdapter.accounts`, `accounts.js`, `accounts.rs`): A data directory on a desktop computer that holds at most one agent's keys and data. A desktop target starts the executor against the selected account and restarts the executor to switch to another one. Example: "The person picks a different account, and the app restarts the executor against its data directory." [Accounts](hosts/platform/accounts.md)

**Active modules** (`spaceStore.activeModules`): The modules that run in the space on screen for this agent: enabled by the space, installed by the agent and not muted by the agent here, plus the agent-scoped modules that the agent installed. A module's chrome and its rail buttons show only while it is active. Example: "Polls is not in `activeModules` until the community enables it." [Enablement](modules/registry/enablement.md)

**Activity shape** (`ActivityShape`, `contributes.activities`): The fields of one presence activity type that a module publishes, each typed `string`, `number`, `boolean` or `object`. Other modules read the activity without an import of the module. Example: "The transcription module declares the `transcribe` activity shape." [Contributions](modules/contract/contributions.md)

**Adapter** (`@we/backend-ad4m`, `@we/backend-inmemory`, `createAd4mBackendPorts`, `createInMemoryBackendPorts`): A package that implements the backend contract for one backend. Only an adapter knows a backend's native types. Example: "The in-memory adapter runs the stores' tests with no executor." [Adapters](data/adapters/README.md)

**Agent-scoped module** (`manifest.scope: 'agent'`): A module that the agent turns on for itself, everywhere, with no decision from a community. It is active also outside a space. Example: "Notes and Pocket are agent-scoped modules." [Enablement](modules/registry/enablement.md)

**AI context** (`@we/ai-context`, `generate.ts`, `schemaContext`): The reference about WE that `@we/ai-context` generates from the packages with a `"context"` field and the hand-written fragments. It goes to `AGENTS.md`, `CLAUDE.md` and the other agent files, and its schema part goes to `schemaContext` for the in-app model. Example: "A new primitive appears in the AI context after `generate-context` runs." [AI context](hosts/ai/ai-context.md)

**Ambient action** (`markAction(fn, doc, { ambient: true })`): A public store action that a template can call when nobody is doing something, for example on render. It changes only what this agent looks at. Example: "`subgroupMessages` is an ambient action, so the Cards view calls it when a subgroup opens." [Store surface](modules/contract/store-surface.md)

**Anchor** (`contributes.anchors`, `{ type: '$slot', props: { anchor } }`): A named place in a module's own chrome where other modules put slots. In the block and transcription code, `anchor` also names the record that a write attaches to; that use is not this term. Example: "The live module puts its menu items into the call module's `call-menu` anchor." [Contributions](modules/contract/contributions.md)

**App bridge** (`startAppBridge`, `appBridge.ts`): The app-shell code that answers an embedded app's frame with the executor connection: the port and token on desktop, or a proxy over `postMessage` on web. It answers only frames from an origin that a registered embed names. Example: "The app bridge sends the embedded app its executor port." [Embedded apps](hosts/platform/embedded-apps.md)

**App page** (`meta.role: 'page'`, `shellStore.openShellView`): A template that is a page of an app and opens above everything. Only a bundle brings an app page. Example: "The bundle opens its directory as an app page." [Templates](interface/templates/README.md)

**App template** (`meta.role: 'app'`, `WeApp.schema.ts`, `resolveAppTemplate`): The template that draws the chrome around every space. The agent chooses it, it is never a space's template, and only it can place host parts. Example: "The app template declares `meta.frame: { left: 80, right: 56 }`." [Chrome](interface/chrome/README.md)

**Backend connector** (`BackendConnector`, `ad4mConnector`, `createLocalAd4mConnector`, `createGuestConnector`, `inMemoryConnector`): The object that a target gives the app shell to reach its data: it initialises the backend and returns the backend ports. Example: "The Tauri target's backend connector asks the Rust process for the port and the credential." [Backend connector](hosts/platform/backend-connector.md)

**Backend contract** (`@we/backend-shared`, `BackendPorts`, `backendPorts.ts`): The set of ports that every backend implements, returned as one `BackendPorts` object for a session. Its required ports are `agentSession`, `lifecycle`, `schemas`, `profiles`, `ephemeral` and `dataBindings`; the other ports are feature-detected. Example: "The renderer and the stores depend on the backend contract, never on `@coasys/*`." [Backend contract](data/backend/README.md)

**Block** (`ContentBlock`, `registerBlock`, `BlockContribution`): One unit of content in a composition, a text block or a typed record, stored as one record and linked from a `CollectionBlock` root through `children`. A module can add a block type for one of its entities. Example: "A poll is a block, so a post can hold one." [Blocks](modules/blocks/README.md)

**Board** (`CollectionBlock` of kind `board`, `arrangedBoard`, `createBoardActions`): A record whose children are columns, where each column is a saved query with an arrangement. A column shows each task whose `status` matches the column's `slug`. Example: "A drop on a bound column of the board writes the task's `status`." [Boards](interface/chrome/boards.md)

**Board lane** (a board column with no `slug`, `lanesOnly` on `taskBoard`): A board column that shows only the cards that a person put in it. A drop on it writes one link on this board only. Example: "Move the card to the 'This week' board lane." [Boards](interface/chrome/boards.md) — not: swimlane

**Boot state** (`BootState`, `SessionStore.bootState`): The state of the session while the app shell starts: `initialising`, `login`, `createAgent`, `finishing`, `ready` or `error`. Example: "The boot state goes to `ready` when the session unlocks." [Session](hosts/boot/session.md) — not: boot phase, boot stage

**Bundle** (format `we-bundle`, seed `bundles`, `judgeBundle`): A whole app as one JSON file. It can hold an app template, space templates, views, app pages, themes, record types, workflows, a brand and a sign-in screen. Example: "Install the bundle from a file in Settings." [Bundles](interface/templates/bundles.md) — not: applet

**Call record** (`recordCallId`, `CollectionBlock` with `kind: 'call'`): The `feed` collection that a call writes when it starts. The call id is derived from its id, and the transcript is written into it. Example: "Everyone who continues a call record joins the same call." [Calls](modules/bundled/calls/README.md)

**Call topology** (`CallTopology`): How a backend call session connects the participants: `mesh` (each to each) or `sfu` (through a relay server). Example: "The call activity carries the topology, so a participant can follow a switch." [Backend sessions](modules/bundled/calls/sessions.md)

**Capability group** (`TEMPLATE_SURFACE`, groups such as `content`, `navigation`, `space-admin`): A named set of store members that a template tier grants. A member that no granted group holds is absent from the template bag. Example: "The `appearance` capability group lets a space template choose among the agent's themes." [Template tiers](interface/templates/tiers.md)

**Cartridge** (`packages/templates/cartridges/`): The TypeScript source of a bundle that WE ships. A build step writes the bundle file from it. Example: "Change the cartridge, then generate the bundle again." [Bundles](interface/templates/bundles.md)

**Chrome** (`HOST_PARTS`, `dockGeometry.ts`, `--we-chrome-<edge>`): The app furniture around a template that stays across spaces: the sidebar, the module rail, the call bar and the editing bar. Example: "Chrome at an edge moves inward for a displacing panel." [Chrome](interface/chrome/README.md)

**Clock** (`Clock`, `ClockRegistry`, `@we/clock`, `ClockStore`): A moment that something shows, plus the playback that moves it, found by a name in one app-wide registry. Two things that follow the same named clock show the same moment. Example: "The globe and the scrubber both follow the clock `events`." [Clocks](data/stores/clocks.md)

**Collapse** (`GraphEngine.collapse`, `ExpansionState`): Closing an expanded graph node. The engine removes only the nodes that no other open node holds, and bundles the edges that crossed the boundary into one weighted edge. Not the same as a fold. Example: "A collapse of the collection keeps a child that a second open node also holds." [Engine](modules/graph-system/engine.md)

**Collection mode** (`CollectionMode`): Who writes a collection and how: `document` (one author, reconciled on edit), `feed` (many agents append, never reconciled) or `collaborative` (one live session). It is stored on the record. Example: "A call record is a `feed` collection." [Persistence](modules/blocks/persistence.md)

**Component** (`@we/components`, `X.types.ts` + `X.solid.tsx`): A Solid component made from primitives that holds behaviour which needs the host's reactive framework, such as overlap calculation, measurement or focus. A template names it by its PascalCase `type`. Example: "`AvatarStack` is a component because it calculates overlap." [Components](interface/design-system/components.md)

**Component registry** (`componentRegistry`, `chromeComponentRegistry`): The map from a PascalCase `type` name to a Solid component, which the renderer reads. The chrome registry adds the components that only host chrome can use. Example: "Register the component in `componentRegistry.tsx`." [Component registry](interface/renderer/component-registry.md)

**Conformance suite** (`@we/backend-conformance`, `describeBackendConformance`, `ConformanceHarness`): One suite of the backend contract's behaviour that every backend runs through its own harness. Example: "The AD4M adapter runs the conformance suite through `test:live`." [Conformance suite](data/adapters/conformance.md)

**Content region** (`--we-chrome-left`, `-right`, `-top`, `-bottom`): The window minus the app's frame and minus each panel that displaces. The shell publishes its edges as CSS variables. Example: "The space template renders inside the content region." [Chrome](interface/chrome/README.md)

**Credential field** (`CredentialField`, `credential.ts`): The host-drawn password input on the boot screen. It writes the password to `credential.ts`, and the unlock and account-setup calls read it from there, so a template never holds the password. Example: "The boot template places the credential field, and the template sees only that a password is entered." [Session](hosts/boot/session.md)

**Custody service** (`we-custody`, `crates/custody`, `DesktopVault`, `we_custody::spawn`, `custodySidecar.js`): The desktop process code that keeps the person's master key and runs the changes to the identity: make the identity, add a device, revoke a device. Tauri links it into its main process, and Electron runs it as a sidecar. Example: "The custody service asks for the passphrase before it signs the revocation." [Custody](hosts/identity/custody.md) — not: custody server

**Data source** (`RendererDataBindings`, `DataBindingDeps`, `BackendPorts.dataBindings`): The part of the backend contract that the schema renderer reads data through: `$currentDataset`, `$getEntity`, `$getEntityForDataset`, `$queryAdapter` and the other bindings that the host adds to a template's store bag. Example: "`TemplateProvider` builds the data source from the current dataset handle and the profile cache." [Data source](data/backend/data-source.md)

**Dataset** (`DatasetRef`, `DatasetHandle`, `DatasetLifecyclePort`): The neutral name for one queryable data container; on AD4M it is a perspective. A `DatasetRef` pairs its id, name and shared address with an opaque handle that only the backend reads. Example: "Each space is backed by one dataset." [Dataset lifecycle](data/backend/lifecycle.md)

**Definition** (`$defs`, `$ref`, `definitions.ts`): A node tree that a template holds once in its root `$defs` and uses at each `$ref` node. A patch inside a definition changes every use; a `split` patch gives one use its own copy. Example: "The card is one definition with six uses." [Schema nodes](interface/schema/nodes.md)

**Design token** (`@we/tokens`, `--we-<category>-<key>`): A named design value on a fixed scale, such as `space` `'300'`, that becomes one CSS variable. Example: "Set the gap to the design token `'300'`." [Design tokens](interface/design-system/tokens.md)

**Disposition** (`Disposition`, `CapabilityGap`, `planQuery`): What a backend does with one query feature: `native`, `compute-up`, `degraded` or `unsupported`. Any gap that is not `degraded` refuses the query. Example: "On this backend, a projection sort without a `limit` has the disposition `degraded`." [Query planning](data/backend/queries.md)

**Drag payload** (`@we/drag`, `{ dataset?, entity, id }`, `dragSession`): The references that a drag carries, never DOM elements. The drop target decides what a drop means. Example: "The column reads the task id from the drag payload." [Drag](interface/design-system/drag.md)

**Editor** (`@we/editor`, `EditorHost`, `EditorStore`): The surface for editing templates and themes. It reaches its host only through the `EditorHost` contract. Example: "The editor's inspector panel opens beside the template." [Editor](interface/templates/editor.md)

**Embedded app** (`seed.apps`, `AppConfig`, `contributes.embed`, `we-iframe`): A separate AD4M app that the seed lists under `apps` and that WE registers as a module whose only contribution is an `embed`, shown in a frame. Example: "The seed `we-with-apps.seed.json` lists Flux as an embedded app." [Embedded apps](hosts/platform/embedded-apps.md) — not: mini app

**Entity** (`EntitySchema`, `CoreEntityDef`, `@we/entities`): A type of stored thing, declared in the manifest, for example `Space` or `TextBlock`. Example: "A module can declare its own entities beside the core entities." [Entities](data/entities/README.md)

**Entity proxy** (`defineEntity`, `getEntity`, `registerEntity`): The object that `@we/entities` exports for each entity name. It forwards every access to the class that the connected backend registered under that name. Example: "`Space.findAll(dataset)` calls the entity proxy, which calls the AD4M class." [Entity proxies](data/entities/proxies.md)

**Ephemeral port** (`EphemeralPort`, `EphemeralScope`, `EphemeralChannel`): The port for transient agent-to-agent state that is lossy, last-write-wins and gone on reload. Each protocol takes a named channel in a dataset's scope. Example: "Presence and call signalling run on the ephemeral port." [Ephemeral and presence](data/backend/ephemeral.md)

**Expander** (`Expander`): A graph plugin that answers "what is next to this node" for the node kinds it claims. All expanders that claim a node run, and their results merge by address. Example: "The `collection` expander opens a collection into its children." [Protocol](modules/graph-system/protocol.md)

**Expression** (`{ $: '<source>' }`, `evaluateExpression`, `ast.ts`): A prop or child value that computes a value from stores, local state and bound names with one closed grammar. A capability that the grammar lacks goes into the function library. An AD4M expression (content at a URL) keeps its AD4M meaning and is always written "AD4M expression". Example: "`{ $: 'spaceStore.viewNav' }` is an expression." [Expressions](interface/schema/expressions.md)

**Feature module** (`ModuleDefinition`, `createModule(host)`): A capability that a space or an agent turns on. It is a manifest and contributions as data, plus at most one store factory as code, and it is built in through the seed. Example: "The polls feature module adds two entities, a block and a view." [Modules](modules/README.md) — not: add-on

**First screen** (`FirstScreen`, `createFirstScreen`, `firstScreen.ts`, `afterFirstScreen`): The gate that holds the work the opening page does not need until that page is drawn, or until `FIRST_SCREEN_CEILING_MS`. Example: "The editor asks for the model status only after the first screen opens." [First screen](hosts/boot/first-screen.md)

**Fold** (`GraphEngine.setFolded`, `foldGraph`): Hiding part of a loaded graph for reading. Nothing is queried or laid out again, and an unfold puts each card back where it was. Not the same as a collapse. Example: "A fold on the canvas hides a card's children and keeps their positions." [Engine](modules/graph-system/engine.md)

**Foreign element** (seed `elements`, `generate-elements`): A custom element from a third-party library that a deployment bundles, such as a chart or a rating. The seed names the package and its tags. Example: "Add the rating library as a foreign element in the seed." [Foreign elements](interface/renderer/foreign-elements.md)

**Fragment** (`@we/schema-kit`, `@we/template-kit`, for example `emptyState`, `taskBoard`): A TypeScript function that takes one options object and returns plain schema nodes when a template is written. The stored template holds only the nodes that it returned. Example: "The confirm dialog inside `we-modal` is a fragment." [Fragments](interface/templates/fragments.md) — not: sub-template

**Graph spec** (`GraphSpec`): The JSON that a template writes for a graph: seeds, expansion, layout, styles, behaviours, controls, viewport and `live`. A computational need is a registered plugin that the spec names. Example: "The schema map's graph spec names the `schema` seed and the `force` layout." [Protocol](modules/graph-system/protocol.md)

**Guest link** (`GuestJoinTarget`, `parseGuestLink`, `guestLink.ts`): A web link of the form `/join/<sharedId>?host=<executorUrl>` that names a shared space and the executor to reach it through. The web target opens it with the guest connector when no session is stored. Example: "A guest link puts a visitor in the space without an account." [Web](hosts/targets/web.md)

**Handler token** (`$invoke`, `$setLocal`, `$toggleLocal`, `$callLocal`, `$resetLocal`, `$touch`): A prop value that becomes a function the element calls on an event. A method gets exactly the `args` that the template writes. Example: "The button's `onClick` is a `$invoke` handler token." [Handler tokens](interface/schema/handlers.md)

**History** (`@we/history`, `createHistory`, `HistoryEntry`, `canvasHistory`): A private stack of this agent's own inverse writes, applied as new forward writes, in one scope. Undo puts a change back; it does not restore a snapshot. Example: "`undoCanvas` replays the last move from the canvas history." [Records](data/stores/records.md)

**Hold** (`Held`, `Holds`, `Optimism.hold`): One value that the screen draws before its write comes back, by key, with the data's value at the first draw after the write as its baseline. Example: "The hold retires when an answer later than the write arrives." [Optimism](data/stores/optimism.md)

**Holds** (`contributes.holds`): A store key. While it is true, the module's chrome stays on screen in a space that has not enabled the module. Example: "The call module's `holds` is `active`, so its chrome stays while the agent opens another space during a call." [Contributions](modules/contract/contributions.md)

**Host part** (`HOST_PART_IDS`, `HOST_PARTS`, `{ type: '$part' }`): A piece that the host draws and an app template places by id: `host.sidebar`, `host.rail`, `host.signIn.form` and `host.signIn.accounts`. Example: "The app template places the `host.rail` host part." [Chrome](interface/chrome/README.md)

**Host source** (`$sources` in the template bag, for example `arrangedBoard`, `calendarMonth`): A function that the host gives to expressions for a calculation the function library does not have. An expression call that is not a library function goes to a host source. Example: "`arrangedBoard` is the host source that calculates a board's columns." [Expressions](interface/schema/expressions.md)

**Identity window** (`@we/identity-window`, `runIdentityWindow`, `IdentityTransport`, `identityWindow.js`): The separate desktop window that is the only page that runs a change to the identity. It draws the custody service's screens and sends back what the person types. Example: "The identity window shows the recovery words." [Identity window](hosts/identity/identity-window.md) — not: key window, vault window

**Interpretation** (`InterpretationKernel`, `interpretationRuntime`): Extraction passes that a language model runs over a collection, and the proposals that they make, which a person accepts or rejects. The host owns the runs, and a module reaches them through the `interpretation` kernel. On AD4M, a pass runs AD4M's own interpretation engine (`runInterpretation`). Example: "After a call, an interpretation pass over the transcript can propose a task." [Interpretation](modules/bundled/transcription/interpretation.md)

**Journey** (`*.e2e.mjs`, `apps/we-web/e2e/`): An end-to-end test that follows a person's path through the built web app, in Chrome, against a real executor with several accounts. Example: "The calls journey starts a call between two devices." [End-to-end tests](hosts/targets/development/e2e.md)

**Kernel** (`requires.kernels`, `deps.kernels`, `KERNEL_NAMES`): A host capability that a module asks for by name, as a neutral type that any host can implement. The store gets only the kernels that its manifest names. Example: "The feed module asks for the `records` and `interpretation` kernels." [Kernels](modules/contract/kernels.md)

**Launcher** (`ModuleLauncher`, `contributes.launchers`): A rail button that calls a store action and is not a panel's button. Example: "The live module's launcher is \"Follow the driver\"." [Contributions](modules/contract/contributions.md)

**Local state** (`$localState`, `local.<name>`, `syncParam`, `persist`): The ephemeral state that a node declares and its subtree reads as `local`. A field can mirror a query parameter or persist on the device. Example: "The search text is local state with `syncParam`." [Handler tokens](interface/schema/handlers.md)

**Manifest** (`EntityManifest`, `CORE_MANIFEST`, `CORE_DEFS`, `validateManifest`): The neutral declaration of entities, from which the record types and each backend's classes are generated or compiled. Example: "The in-memory adapter compiles the same manifest that AD4M uses." [Manifest](data/entities/manifest.md)

**Module panel** (`PanelContribution`, dock id `<moduleId>:<name>`): A surface that a module declares and that the host places in a dock, frames, opens and remembers. A panel with an icon gets a rail button. Example: "The transcript panel opens beside the call." [Contributions](modules/contract/contributions.md)

**Module part** (`contributes.parts`, `ModulePart`, `<moduleId>.<name>`): A named fragment that a module publishes and that a template places with `$part`. A part is public API. Example: "A template places `polls.pollComposer` to let members ask a question." [Contributions](modules/contract/contributions.md)

**Module rail** (`host.rail`, `core:chromeRail`, `CHROME_RAIL_PX`): The 56px chrome strip on the right that holds the module launchers and pickers. Example: "The module rail moves down to clear the call bar." [Chrome](interface/chrome/README.md) — not: right sidebar

**Module setting** (`ModuleSetting`): One value that a module lets somebody decide, declared with its levels and its resolution. The host draws the controls, stores the answers and gives the resolved values to the store. Example: "`recordCalls` is a module setting that resolves by `restrict`." [Module settings](modules/contract/settings.md)

**Module surface** (`moduleSurface`): What a module is, derived from its contributions: `app`, `chrome`, `content` or `capability`. It decides whether the community has a switch for the module. Example: "The globe module is a `capability` module, so it has no switch." [Lint and compatibility](modules/registry/lint.md)

**Node address** (`entityAddress`, `parseAddress`, `NodeKind`): The one stable string that identifies a graph node, made and parsed only in `address.ts`. The engine treats it as opaque. Example: "Two expanders that return the same node address make one node." [Protocol](modules/graph-system/protocol.md)

**Node operator** (`$each`, `$single`, `$if`, `$agent`, `$routes`, `$animate`, `$surface`, `$part`, `$panels`, `$slot`, `$ref`): A node whose `type` starts with `$`. It controls structure, not appearance. Example: "`$each` is the node operator for a list." [Node operators](interface/schema/operators.md)

**Optimism** (`@we/optimism`, `createOptimism`, `Rules`): The package that holds values drawn before their writes come back and decides, by five rules, when to stop believing them. It is a promise about presentation, not a cache and not part of the backend contract. Example: "`RecordStore` uses optimism for card styles." [Optimism](data/stores/optimism.md)

**Panel** (`dockRegistry`, `PanelHost`, `meta.panels`, `shellStore.openPanel`): A surface that a module, the editor or a template opens beside the content. The host chooses where it goes, and it is floating, snapped, displacing or maximised. The code also calls it a dock. Example: "Notes open as a floating panel." [Panels](interface/chrome/panels.md) — not: flyout

**Panel lane** (`PanelLane`, `EdgeLanes`, `$panels`, `band`): A row of panels along one axis: a band at a window edge, or a `$panels` outlet in a template. Panels that share a place in a panel lane are a group, drawn as tabs. Example: "The template's `$panels` outlet is a panel lane." [Panels](interface/chrome/panels.md)

**Personal space** (`access: 'personal'`, `createSpace`): A space whose dataset is local and not published. Example: "A personal space can still be listed in the global dataset." [Spaces](data/spaces/README.md)

**Platform adapter** (`PlatformAdapter`, `webPlatform`, `electronPlatform`, `tauriPlatform`, `previewPlatform`): The object that a target gives the app shell to say where WE runs: app URLs, desktop or not, development or not, and the optional host parts such as accounts and executor settings. Example: "The web platform adapter has no `accounts`." [Platform](hosts/platform/README.md)

**Policy** (`Policy`, `Permission`, `evaluate`, `policyInForce`, `createPolicyCheck`): A space's allow-list of permissions, kept as versioned `Policy` records in the space and judged at the write check. There are no deny rules; an `except` takes away. Example: "A space with no policy reads as the open policy." [Policy](data/spaces/policy.md)

**Presence** (`PresenceState`, `createHeartbeatPresence`, `derivePeers`, `PresenceStore`): The protocol on the ephemeral port that publishes where each agent is and what it is in. Liveness is measured from the age of `updatedAt` and is never sent. Example: "Presence carries only the `agentId`; the profile comes from `$identities`." [Ephemeral and presence](data/backend/ephemeral.md)

**Preview host** (`@we/app-preview`, `apps/we-preview`, `__wePreview`): The app shell over an in-memory backend and one fixture, built to render a template for a screenshot. Example: "`we-render` serves the preview host and waits for `__wePreview`." [Preview host](hosts/targets/development/preview.md)

**Primitive** (`@we/primitives`, `we-*` tags, `DesignSystemElement`): A Lit custom element with a `we-` name that holds focus, the top layer, measurement or keyboard behaviour. A template names it by its tag, and any framework renders it. Example: "`we-modal` is a primitive because it traps focus." [Primitives](interface/design-system/primitives.md)

**Protected piece** (`CredentialField`, `PROTECTED_SLOTS`, `safeMode`): A part of the interface that no template, theme, seed or bundle can replace: the password field, the safety prompts and safe mode. Example: "The install prompt is a protected piece." [Protected pieces](interface/chrome/protected-pieces.md)

**Query IR** (`QueryIR`, `compileQuery`, `routeQuery`, `executeQueryIR`): The backend-neutral, versioned description of the data a template asks for, which each backend plans and lowers or refuses. Example: "`routeQuery` compiles the `$query` to the query IR before the adapter plans it." [Query planning](data/backend/queries.md)

**Reactivity port** (`memo` in `resolveProp`, `markReactive`): The framework signal primitive that the schema semantics receive, so the semantics stay framework-neutral. The Solid renderer passes `createMemo`. Example: "A renderer for another framework supplies only its reactivity port." [Renderer](interface/renderer/README.md)

**Record** (`RecordInstance`, `RecordStore`): One stored instance of an entity. Example: "A `Placement` record holds where one card sits on one canvas." [Entities](data/entities/README.md)

**Renderer** (`RenderSchema`, `@we/schema-solid`): The adapter that walks a schema tree, resolves each prop, maps the node operators onto Solid's control flow, and mounts each node. Example: "The renderer mounts `we-button` as a custom element." [Renderer](interface/renderer/README.md)

**Role** (colour roles such as `surface`, `text-muted`, `accent-border`): A design token that says what a colour is for. A theme changes roles, and a scale position cannot express a relation that inverts between light and dark. Example: "Use the `text-muted` role, not a grey from the scale." [Design tokens](interface/design-system/tokens.md)

**Safe mode** (`safeMode.ts`, `?safe`, `leaveSafeModeInto`): A state of one tab that draws only WE's own templates and themes and changes nothing. It starts from `?safe`, a key chord, or a render that did not finish. Example: "Open the tab in safe mode and choose another app." [Protected pieces](interface/chrome/protected-pieces.md)

**Schema node** (`SchemaNode`, `type`, `props`, `children`, `id`): One object in a template tree. Each node has a permanent `id`, so an edit names a node, not a position. Example: "The patch targets the schema node by its `id`." [Schema nodes](interface/schema/nodes.md)

**Seed** (`we-seed.json`, `WE_SEED`, `WeSeedModule`): The JSON file that describes one deployment: its modules, templates, views, bundles, elements, embedded apps and deployment settings. The module registry is generated from its `modules` list. Example: "A module that the seed does not name is not in the bundle." [Seed](modules/registry/seed.md)

**Seed source** (`SeedSource`, `seeds.source`): A graph plugin that gives the nodes a graph starts with, before any expansion. Not the deployment seed. Example: "The `query` seed source loads the instances of one entity type." [Protocol](modules/graph-system/protocol.md)

**Setting level** (`SETTING_LEVELS`): Where a module setting's answer is stored, and who decides it: `deployment`, `agent`, `space` or `agent-in-space`. Example: "`showCallTranscripts` has only the `agent-in-space` setting level." [Module settings](modules/contract/settings.md)

**Shape** (`Shape`, `ShapeStore`, `SchemaPort.shapes`, `createJsonShapeStore`, `createAd4mShapeStore`): An entity that a space defines for itself, stored once in its backend's schema form and read and written as a manifest. Example: "`ShapeStore` registers each shape for its dataset only." [Shapes](data/spaces/shapes.md)

**Shared space** (`access: 'shared'`, `share`, `joinSpace`): A space whose dataset is published, so other agents can join it; its `Space` record's `url` is the shared id. Example: "A shared space is a neighbourhood on AD4M." [Spaces](data/spaces/README.md)

**Shell template** (no `meta.role`, `{ path: '$views' }`): A template that owns a space's chrome, arrangement and route table. It marks where the space's sections go with a `$views` route. Example: "The shell template shows the nav strip from `spaceStore.viewNav`." [Templates](interface/templates/README.md)

**Sidebar** (`host.sidebar`, `core:sidebar`, `SIDEBAR_PX`): The 80px chrome strip on the left that holds the spaces, the profile and settings. Example: "Maximise the panel to hide the sidebar." [Chrome](interface/chrome/README.md) — not: left rail

**Sign-in step** (`SignInStep`, `signInStep`, `signInStep.ts`): The one step the boot screen shows, computed from the boot state and the account flags: `switching`, `setUpAi`, `settingUp`, `starting`, `preparing`, `unlock`, `create`, `failed` or `ready`. Example: "The boot screen shows the password form when the sign-in step is `unlock`." [Session](hosts/boot/session.md) — not: login step

**Slot** (`SlotContribution`, `slotRegistry`): A module's chrome at a named anchor, over the content, that stays when the agent navigates. Example: "The transcription module's call control is a slot at the `call-controls` anchor." [Contributions](modules/contract/contributions.md)

**Space** (`Space`, `SpaceStore`): A community or a context, backed by one dataset, with a `Space` record in that dataset that holds its name, sections, modules and defaults. Example: "Every member reads the same `enabledViews` from the space's `Space` record." [Spaces](data/spaces/README.md)

**Store** (`*Store.tsx`, `StoreProvider`): A Solid context in `@we/app-shell` that holds reactive state and actions for one area, read by templates. Stores mount in a fixed order because each reads the stores above it. Example: "`DatasetStore` reads the ports from `SessionStore`." [Stores](data/stores/README.md)

**Store surface** (`markState`, `markAction`, `storeSurface`): The members of a module store that a template can reach as `modules.<id>.<name>`. A member is private until the store marks it, with a required `doc`. Example: "`vote` is on the polls store surface." [Store surface](modules/contract/store-surface.md)

**System dataset** (`SYSTEM_DATASETS`, `SYSTEM_DATASET_NAMES`, `isSystemDataset`): A dataset that the host makes for itself and that is never a space: `we-root`, `we-personal` or `we-test`. Example: "The write check does not judge a write to a system dataset." [Datasets](data/stores/datasets.md) — not: system perspective

**Target** (`apps/we-web`, `apps/we-electron`, `apps/we-tauri`, `@we/app-*`): An app package that runs the app shell with a platform adapter and a backend connector. A desktop target also starts the executor and the custody service. Example: "Each target's `build` script is `we-build`." [Targets](hosts/targets/README.md) — not: wrapper app

**Template** (`TemplateSchema`, root node with `meta`): A root schema node with `meta` that the renderer draws against a template bag. `meta.role` says if it is a shell, a view, an app or a page. Example: "The space renders its default template." [Templates](interface/templates/README.md)

**Template bag** (`buildTemplateBag`, `templateBag`, `chromeBag`): The object of stores that a template renders against. It holds only the store members that the template's tier grants. Example: "`trustAgent` is not in the template bag of a space template." [Template tiers](interface/templates/tiers.md)

**Template query** (`$query`, `$queries`, `subscriptionPool.ts`): A `$query` token in a template: a backend-neutral question for records of one entity, which the renderer turns into a live subscription. Example: "The list's `items` is a template query for `TaskBlock` records." [Template queries](interface/renderer/queries.md)

**Template tier** (`SPACE_TIER`, `CHROME_TIER`): A list of capability groups that a template gets. A space template gets `SPACE_TIER`, and host chrome gets `CHROME_TIER`. Example: "The boot screen renders at the chrome template tier." [Template tiers](interface/templates/tiers.md)

**Theme** (`applyThemeVars`, `THEME_PRESETS`, `themeRegistry`): An object of settings, not a stylesheet, that becomes CSS variables on one root. It names roles and families, never the internals of a component. Example: "The space wears the `retro` theme." [Themes](interface/design-system/themes.md)

**Theme tier** (system, components, CSS; `--we-theme-<component>[--<variant>]-<key>`): One of the three levels at which a theme speaks. The system tier sets the colour families, roles, type roles, shape and density. The components tier sets one component or one variant apart from its family. The CSS tier holds effects that no setting expresses. Example: "Set the soft button radius at the components theme tier." [Themes](interface/design-system/themes.md) — not: subtheme

**Toolset** (`RecordToolset`, `toolsets`, `templateToolset`, `themeToolset`): A set of agent tools for one kind of record that holds nothing between calls. A host passes each call the record as it is stored now and writes the properties the call returns. Example: "The template toolset gives `template_read`, `template_update` and `template_create`." [Agent tools](hosts/ai/agent-tools.md)

**Validation context** (`ValidationContext`, `buildValidationContext`): The names that the semantic validation pass checks a template against: the components and their props, the store members, the entities, the expression functions and the host sources. Example: "The editor adds the space's shapes to the validation context." [Validation](interface/schema/validation.md)

**View** (`meta.role: 'view'`, `meta.segment`, `Space.enabledViews`): A template that renders one section of a space at one URL segment. The host expands a shell's `$views` route into one route per view. Example: "Hide the calendar view for yourself." [Views](interface/templates/views.md)

**we-personal** (`SYSTEM_DATASET_NAMES.personal`, `personalDataset`): The system dataset that holds what the agent made or kept, such as notes and the Pocket, with the ordinary space schema. Nothing that repairs configuration reaches it. Example: "Agent-scoped module records live in we-personal." [Datasets](data/stores/datasets.md)

**we-root** (`SYSTEM_DATASET_NAMES.root`, `rootDataset`, `installRoot`): The system dataset that holds the app's configuration: `AgentSettings`, installed templates and themes, per-space preferences. Its schema is installed again on every boot, and a repair or a reset may touch it. Example: "The default theme is read from `AgentSettings` in we-root." [Datasets](data/stores/datasets.md) — not: root perspective

**Write check** (`EntityWriteCheck`, `checkEntityWrite`, `registerEntityWriteCheck`): The one function that every record write passes before the backend makes it. The host registers it, and every backend calls it from its own write path. Example: "`SpaceStore` registers the policy check as the write check." [Write path](data/entities/writes.md)
