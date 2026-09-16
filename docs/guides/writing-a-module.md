# Writing a module

A feature module is **stateful capability a community turns on**: calls, transcription, a poll, a
reading list. A module declares what it contributes and the host decides where it renders. This
guide is the shape of one, contribution by contribution, with a bundled module as the worked example
for each. The contract itself is `packages/module-system/shared/src/module.ts`; read this first,
then that.

If what you want is a different _arrangement_ of things that already exist — a feed, a page, a
theme — you want a template or a view, not a module. A module is for state and for code: something
that talks to a kernel, owns an entity, or does a thing a schema cannot express.

## The shape

```ts
export const pollsModule = defineModule({
  manifest: {
    id: 'polls',
    name: 'Polls',
    description: 'Ask the space a question and watch the answer arrive.',
    icon: 'chart-bar',
    requires: { kernels: ['records'] },
  },
  contributes: {
    entities: { manifest: POLLS_MANIFEST },
    parts: { pollCard, pollComposer },
    blocks: [{ entity: 'Poll', card: 'pollCard' }],
    views: [pollsView],
    functions: [tallyFunction],
    settings: [{ key: 'revealBeforeVoting' /* … */ }],
  },
  createStore: (deps) => createPollsStore(deps),
});

export const createModule = (_host: ModuleHost) => pollsModule;
```

Three things, named as three. The **manifest** is who the module is and what it needs — shown at
install, compared at registration. **Contributions** are what it puts in front of a person — data the
host fans out to its registries. **`createStore`** is the one piece that is code, and it is optional.
The notes module has none.

Every module package exports `createModule(host)`. That one shape is what lets the deployment's
registry be generated from the seed: `pnpm --filter @we/app-shell generate-modules` reads
`we-seed.json`, imports each package, and nothing else has to know a module exists.

## Start here

```sh
pnpm create-module bookmarks "Bookmarks" --icon bookmark
```

That writes `packages/module-system/bookmarks/` in the shape of the notes module and prints the five
steps that follow. Or copy a bundled module: **notes** for a module that is entirely declaration,
**pocket** for one with a store over the agent's own data, **polls** for one that uses every kind of
contribution, **call** for one built on kernels.

## Declare what you can, write only what a declaration cannot say

The rule that shapes every good module. Almost everything a module does is expressible as data:

| You want                                         | Contribute                       | Example                        |
| ------------------------------------------------ | -------------------------------- | ------------------------------ |
| Records of a new kind                            | `entities` — an `EntityManifest` | `Poll`, `Vote`                 |
| A surface the host places, frames and remembers  | `panels`                         | the notes panel                |
| A fragment templates can place                   | `parts`                          | `call.tile`, `polls.pollCard`  |
| A content type a person composes into a post     | `blocks`                         | a poll inside a post           |
| A section a space can enable                     | `views`                          | the polls section              |
| A function expressions can call                  | `functions`                      | `tally({ votes, options })`    |
| A decision the community or the agent makes      | `settings`                       | "record calls automatically"   |
| Overlay chrome that survives navigation          | `slots`                          | the call bar                   |
| A place other modules can add to                 | `anchors`                        | the call bar's `call-controls` |
| A framework component, when nothing else will do | `components`                     | `CesiumGlobe`                  |

What is left for code is small: a write that depends on a read, a device, a peer connection, a
running algorithm. The polls store is thirty lines, and every line is there because casting a vote
means _finding the one you cast before_, which a click handler cannot do.

## Entities

Declared, never written against a backend:

```ts
export const POLLS_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Poll: {
      blockable: true,
      authoring: { fields: ['question', 'options'] },
      display: { title: 'question' },
      properties: {
        question: { type: 'string', required: true, default: '' },
        options: { type: 'string', required: true, default: '' },
        version: { type: 'number', default: 0 },
      },
      relations: {},
    },
  },
};
```

Predicates are minted under `we://module/<id>/<property>` for you. **Reuse the core vocabulary freely
by name** — a property called `name` binds to `we://name`, and generic UI that shows names then works
on your entity for free. What you may not do is mint a new flat `we://<word>`; the registry refuses
it, because a predicate mistake orphans data rather than failing.

`entities: { scope: 'agent' }` installs into the agent's own root dataset instead of the space — for
what a module knows about _you_. Pair it with `manifest.scope: 'agent'` (the pocket).

**Own the container, never the content.** A note is a core `TextBlock` in a collection the module
owns, not a `Note`. A vote names its poll by id and is read back by a query. Two nouns for one thing
means records that can never meet.

## Panels

```ts
panels: [{ name: 'main', title: 'Notes', icon: 'note', node: panel, bid: { edge: 'right', size: 'md' } }];
```

One object. `name` is required and stable — a placement is remembered against `<id>:<name>`, and a
template's `meta.panels` names it. `icon` gives it a rail button; leave it off for a panel opened
some other way. `bid` is how it would like to open, and the host resolves it against the viewport
and remembers wherever somebody drags it.

**The host owns whether a panel is open.** The rail toggles it, a template opens it, the titlebar
closes it, and your module never sees the flag. This is the right owner for nearly every panel, and it
is why the notes module has no store at all. If openness genuinely _is_ your module's own state — the
call's stage is up while there is a call to watch, the pocket resolves its root folder on opening —
name `open` (a boolean state key), `show` and `close` (action keys) on the panel, and the host reads
through. A `bid` may also be a store key, for a panel whose shape is state (a stage that wants `'full'`
while somebody shares a screen).

A panel's `node` renders against the **chrome bag**, so it sees every member of your store, marked or
not. Compose it out of your own parts with `{ type: '$part', props: { id: '<id>.<part>' } }` — the
pieces a template can then place on their own.

## Parts

Named fragments a template places. **A part is public API**: keep the set small and name each for
what it _is_. A part written against a subject — a feed over `modules.transcribe.collectionId` — names
it, so a placer may point it at another record:

```ts
parts: { transcriptFeed: { node: transcriptFeed, subject: 'modules.transcribe.collectionId' } }
```

## The store, and what a template may reach

```ts
createStore: ({ signal, state, action, kernels, selfId, notify }) => {
  const records = kernels.records;
  const [voting, setVoting] = signal('');
  async function vote(pollId: string, option: string) {
    /* find mine, update or create */
  }
  return {
    voting: state(voting, 'The id of the poll a vote is being written for, or empty.'),
    vote: action(vote, 'Casts this agent’s vote on a poll, or changes it.'),
    plumbing: () => 'right', // unmarked: the module's own chrome sees it, no template does
  };
};
```

Reactivity is **injected** — `signal`, `effect` — so a store never imports a framework. That is not
tidiness: a module bundle importing its own copy of a reactive framework gets a second runtime, and
reactivity silently stops crossing the boundary.

**Members are private by default.** `deps.state(accessor, doc)` and `deps.action(fn, doc)` publish a
member with a required one-sentence description; everything else is visible only to your own panels
and parts. A marked state member is read in an expression as `modules.<id>.<name>`; a marked action is
called with `$action` and cannot be read. The description is what the generated reference prints, and
what the validator checks a template's `modules.<id>.<name>` against — a member you did not mark is
as unknown to a template as one you never had.

Teardown goes through `deps.onDispose(fn)`, never a `destroy` key on the store: store keys are
template-callable vocabulary.

## Kernels — what a store may reach

A kernel is a host capability a module asks for **by name**:

```ts
manifest: {
  requires: {
    kernels: ['records', 'presence'];
  }
}
```

The registry refuses a module naming a kernel the host does not implement, with a sentence; the deps
bag carries only the kernels you asked for under `deps.kernels`; an install screen lists them. The
kernels are in `packages/module-system/shared/src/kernels.ts`:

| Kernel           | For                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `records`        | Records in the space — `create`, `link`, `update`, `remove`, and **`find` / `subscribe`**, the read half a module never had |
| `agentData`      | The agent's own records, for `entities: { scope: 'agent' }`                                                                 |
| `presence`       | Who is here and what they are doing; publish an activity of your own                                                        |
| `ephemeral`      | Peer-to-peer transport, for coordinating without storing                                                                    |
| `media`          | `getUserMedia` / `getDisplayMedia`; `publish` what you capture, `input()` what another module did                           |
| `peerConnection` | `RTCPeerConnection`s, overridable in a test                                                                                 |
| `transcription`  | Speech to text on the node's model; `available()` says whether there is one                                                 |
| `languageModel`  | One prompt in, text back, on the node's own model                                                                           |
| `interpretation` | Turning what was said into typed records                                                                                    |
| `secrets`        | A `type: 'secret'` setting's value — an API key — reached here and never through `settings()`                               |

Kernels that depend on the backend carry an `available()`; **degrade rather than throw** when one
answers no. A module must also survive a kernel being absent: a host may legitimately have no
transport, and a test builds your store with none.

The one trigger a module has is `records.subscribe` — records changed. Anything periodic has no medium
yet, deliberately; see `docs/architecture/capabilities-and-surfaces.md`.

## Blocks, views and functions

A **block** is an entity a person composes into a post: `{ entity: 'Poll', card: 'pollCard' }` names
one of your parts as the card, and the block renders wherever a composition does, drawn over the record
bound as `block`. Mark the entity `blockable` (which obliges a `version`). Without an `input`
component the block is inserted through the record form rather than typed in place — the honest limit
of a declaration.

A **view** is a section a space may enable — a `TemplateSchema` with `meta.role: 'view'` and an `id`.
It joins the catalogue beside the built-in sections and `Space.enabledViews` gates it exactly the same
way. A module still cannot change the address space.

A **function** is lent to expressions and catalogued beside the host's own — the same `{ name,
params, doc, example, fn }` shape as a host source. Pure and total: wrong-typed input answers with the
empty value of its kind, never a throw.

## Settings, activities, holds

`settings` declares what a community or an agent decides; the value comes back resolved through
`deps.settings()`, and the host renders the control. `restrict` is for the decisions a lower level may
refuse and never grant. `type: 'secret'` is for a value a template must never see.

`activities` declares the presence activities you publish — `{ call: { id: 'string', record: 'string' } }`
— so the second module cooperating with you reads them from a declaration rather than from your tests.
The presence kernel warns, in development, about a publish that disagrees.

`holds` names a store key that keeps your chrome on screen in a space that has not enabled you, while
true — a call that outlives navigating away from it. Make it false the moment you stop holding anything.

## Capabilities meet in a medium, never in each other

A module may not depend on a module. Two capabilities that cooperate meet in something the host
provides: the **graph** (one writes records, the other reads them), **presence**, **ephemeral**,
**anchors** (`anchors: ['call-controls']` and `{ type: '$slot', props: { anchor: 'call-controls' } }`
in your chrome; another module contributes a slot to it). A bare `{ $: 'modules.call' }` condition
is the one permitted reference to another module by name: it asks whether it is installed.

A **template** that reaches your module by name says so — `meta.requires.modules: ['polls']` — so a
deployment without it sees the reason instead of a blank panel.

## Testing

```ts
import { buildStore, fakeDeps, fakeRecords, lintModule } from '@we/module-testing';

const records = fakeRecords();
const store = buildStore(pollsModule, fakeDeps({ kernels: { records: records.kernel } }));
await store.vote('poll-1', 'tea');
expect(records.rows).toHaveLength(1);
expect(lintModule(pollsModule).problems).toEqual([]);
```

`buildStore` hands the store only the kernels the manifest names, as the registry does, so a test
cannot pass while the manifest forgets one. `lintModule` is the registry's own judgement, pure.
`pnpm validate:schemas` checks your fragments the way it checks every template, and knows your module's
members, parts and entities once the reference is regenerated.

## Shipping

1. `we-seed.json` `modules` — the id, or `{ "id": "polls", "enabled": false }` to ship it for
   communities to opt into rather than switching it on in every existing space.
2. `packages/app-shell/package.json` (and `packages/ai-context/package.json`) depend on the package.
3. `pnpm --filter @we/app-shell generate-modules` — the registry is generated; there is no hand list.
4. `pnpm --filter @we/ai-context generate-context` — the reference documents your module, and the
   validator learns its names.

A module from **outside this repository** arrives the same way: publish the package, and a deployment
names it — `{ "id": "polls", "package": "@acme/we-module-polls" }` — adds the dependency and rebuilds.
The deployment trusts it the way it trusts `@we/module-call`. That is the distribution rung for code:
a deployment, not a marketplace. Nothing `import()`s a module from an expression, at any rung.

## What is refused, and why

- **Routes.** Installing a module never changes the address space; ship a view.
- **Middleware.** A capability observes and produces; nothing sits in another's write path.
- **Module-to-module imports or `modules.<other>.<member>` reads.** A per-space toggle must not become a
  dependency graph a person has to reason about.
- **Framework imports in a module package.** Contribute a component through `ModuleHost` if you must;
  see the globe.
- **A `destroy` on the store.** Teardown is the host's, through `deps.onDispose`.
