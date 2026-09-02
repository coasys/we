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

A space's own sections are tier 1, and that is the reason they are routes rather
than panels: which section you are looking at is a location, so a link carries
it. Their _arrangement_ — which sections a space has, and in what order — is not
view state either; it is a property of the space, stored on it and shared with
every member. Each agent's private hiding of a section is tier 3. See
`views.md`.

**One record is tier 1 too**, at `/record/:entity?id=…` — injected by the host
wherever a shell puts its sections, so it nests under whatever the sections nest
under. "Look at this one thing" is a location and needs an address; expanding a
card is not one, and cannot be sent to anybody. The entity is in the path because
a schema cannot ask what type an id is: `$query` needs an entity to query.

**The id is the one identity that lives in a query value, and the reason is not a
preference.** A record's id is a URI — `ad4m://obj/<random>` — so as a path
segment it is five segments and the route does not match. Percent-encoding it
would work, and would need an encode in the schema layer and a matching decode
on the way out (Solid Router does not decode route params), where a mismatch is
another silently wrong page. A query value takes `:` and `/` literally. Read it
with `routeStore.params.id`. See `views/RecordPage`.

**2. View state — how it's arranged → query params, via `syncParam`.**
Selected content type, sort field/direction, active filters, search text: the
things a link's recipient should see exactly as the sender does. Declared on
the owning `$localState` field:

```ts
contentType:   { type: 'string', initial: 'posts', syncParam: { name: 'type', push: true } },
sortDirection: { type: 'string', initial: 'DESC',  syncParam: 'dir' },
searchText:    { type: 'string', initial: '',      syncParam: 'q' },
```

Reads and writes stay `local.*` / `$setLocal` — the mirroring is declarative.
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

## Who owns which part of the path

**The host owns `/space/:spaceId`. A template owns everything below it.**

The URL is what answers "which space am I in" — `SpaceStore`'s dataset effect
reads `segments[0] === 'space'` and does nothing otherwise — so a template
mounted anywhere else has no space at all, whatever its content assumes. That is
a property of the prefix, not of routing your own screens, so the host supplies
it to every template rather than each one remembering: a template that declares
the prefix (the `$views` kind) matches it, and one that routes itself is wrapped
in it. `SPACE_ROUTE_PATH` is the single literal.

`$views` therefore means one thing only: **the community picks the sections
here.** It is not a statement about where the template lives. A template that
declares its own screens (`/board`, `/channel/:id`) is still a space template
and still lives under the prefix; it simply names its children itself.

Two consequences worth stating, because both were learned the hard way:

- **A template navigates relatively.** `'./board'`, not `'/board'` — an absolute
  target leaves the space, and inside a parameterised parent an absolute
  `redirect` is joined to the _pattern_, producing a literal `/space/:spaceId/…`
  that matches nothing.
- **A template reads positions from `routeStore.templateSegments`, not
  `segments`.** The latter is the whole URL, so an index into it is pinned to
  wherever the host mounts things; the former is relative to the template's own
  root, so `/photo/:postId` reads `[1]` regardless of the prefix.

**One space, one address.** Both the local id and the shared id resolve, so a
shared space could be reached at two URLs depending on which code path built the
link — two history entries, two share links, two answers to "am I already here".
`canonicalSpaceId` decides: the shared id when there is one, the local id
otherwise. The other form still resolves, as an alias rather than an equal.

## The shell overlay has no address, deliberately

Profile, settings and the landing page run in a `MemoryRouter` and never touch
the browser URL. This is a decision, not an oversight, and the reason is a trust
boundary rather than convenience:

**templates declare their own route tables, and templates install from
strangers.** `templateAcceptance` vets structure and store references; it does
not inspect paths. So a template in the browser Router's coordinate space could
declare `/settings` and render whatever it liked there. Outside it, that is not
expressible.

There is a quieter version of the same point: a surface you use to _fix_ a bad
template must not be rendered by that template's route table. Settings has to
render identically whichever template is loaded, including a broken one.

So the two routers are one per trust domain — the browser Router is the
template's space, which is untrusted data; the MemoryRouter is the app's, which
is code. The costs are real and accepted: Back does not close an overlay, and a
reload does not reopen it. Both are ordinary overlay behaviour.

**If a shareable settings link is ever wanted**, the shape is a top-level,
space-free path (`/settings/appearance`) that is _consumed on arrival_ — it opens
the overlay and replaces the URL with the app's normal state. Not a composite
like `/space/<id>/posts?shell=settings`: the space in such a link is the
sender's, and a recipient who has not joined it lands on a join gate with their
own settings floating over it.

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
as `{ $: 'routeStore.params.<name>' }`) and
`routeStore.setParam(name, value | null, { push? })`. `setParam` writes
history directly — the path doesn't change, so the route tree must not
re-resolve.

## What this replaces

Before this convention, view state was plain local state (reset on every
reload) and the first persistence pass put content type and sort into device
storage — which made the same URL show different content on different
machines, the opposite of shareable. Device storage is now reserved for
tier 3.
