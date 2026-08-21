# Routing & View State — where state lives

The convention for deciding where a piece of UI state belongs. Written down
because every option (path, query params, device storage, agent settings,
plain local state) is easy to reach for, and the costs of picking wrong are
quiet: unshareable views, links that impose preferences, filters that
silently hide content.

## The four tiers

**1. Location — what am I looking at → the path.**
Entity identity and page structure: `/space/:spaceId`, `/post/:id`, tab-like
sub-pages as child routes. The tabs-and-routing pattern in the generated
reference is the canonical shape. Back/Forward must work; every path is a
shareable address.

**2. View state — how it's arranged → query params, via `syncParam`.**
Selected content type, sort field/direction, active filters, search text: the
things a link's recipient should see exactly as the sender does. Declared on
the owning `$localState` field:

```ts
contentType:   { type: 'string', initial: 'posts', syncParam: { name: 'type', push: true } },
sortDirection: { type: 'string', initial: 'DESC',  syncParam: 'dir' },
searchText:    { type: 'string', initial: '',      syncParam: 'q' },
```

Reads and writes stay `$local`/`$setLocal` — the mirroring is declarative.
Semantics:

- **Push vs replace:** a content-type switch deserves a Back entry
  (`push: true`); sort/filter/search changes replace, so history doesn't fill
  with keystrokes. Default is replace.
- **Clean URLs:** a field back at its declared `initial` removes its param.
  Defaults are never spelled out in the address.
- **Precedence on mount:** URL param > persisted value > declared `initial`.
- Param names are short and per-view (`type`, `sort`, `dir`, `q`); two lists
  on one page must not share names.
- The machinery is the host's `$routeParams` binding (app shell wires it from
  `routeStore`); a host without it degrades to plain local state.
- **Params survive leaving and returning:** the store remembers each path's
  last query string (in memory, per session) and `navigate('/cards')` restores
  it. Keep-alive routes hold their live state across navigation, so without
  this the screen and the URL disagreed the moment you came back — and a
  reload believed the URL. An explicit `?` in the navigation target always
  wins over the memory.

**3. Preferences — how I like things → `persist` (device) or AgentSettings (agent).**
Display density, collapsed rails, panel widths. A shared link must NOT impose
these on its recipient, so they stay out of the URL. `persist: '<key>'` keeps
them on the device (explicit namespaced key, e.g. `'cards.displayMode'`);
promote to `AgentSettings` when a preference should follow the agent across
devices.

**4. Ephemeral — in-the-moment → plain `$localState`.**
Open modals, in-flight flags, drag state. Survives nothing, and shouldn't.

The dividing question for any field: _"If I sent this URL to someone else,
should they see the effect?"_ Yes → tier 1 or 2. No, but future-me should →
tier 3. No one → tier 4.

## Template & theme suggestions in links

A link may carry `?template=<id>` and/or `?theme=<id>` — "view this the way I
do". Handled by the shell (`TemplateProvider`), not by templates:

- **Available** (built-in, installed, or a space template): applied silently,
  exactly as if the recipient had picked it — clicking the link is the
  consent. Idempotent, so reloading or re-sharing the link is safe.
- **Not available:** the app keeps what the recipient already uses and says so
  once, with a warning toast naming the missing template/theme — the link's
  intent is degraded, not silently dropped.

Suggestions are matched by id against the recipient's own lists, which
resolve as templates/themes stream in — a space template that arrives after
boot still gets honored.

## Store surface

`routeStore.params` (reactive `Record<string, string>`, readable from schemas
as `{ $store: 'routeStore.params.<name>' }`) and
`routeStore.setParam(name, value | null, { push? })`. `setParam` writes
history directly — the path doesn't change, so the route tree must not
re-resolve.

## What this replaces

Before this convention, view state was plain local state (reset on every
reload) and the first persistence pass put content type and sort into device
storage — which made the same URL show different content on different
machines, the opposite of shareable. Device storage is now reserved for
tier 3.
