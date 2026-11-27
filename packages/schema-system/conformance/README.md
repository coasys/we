# @we/template-conformance

Recorded input → expected-output vectors for WE's template language. Two renderers implement the
same semantics — the TypeScript one in this repo, the Rust/egui one under `crates/renderer/` — and
this package is how they prove it: the real TS implementation produces every vector, the committed
JSON files are the contract, and `vectors.test.ts` re-records in memory and fails on any drift.

There is no Rust here and nothing here changes renderer behaviour. Cases are hand-written
(`src/cases/*.ts`); vectors are produced, never written by hand.

## Commands

```bash
pnpm --filter @we/template-conformance record          # regenerate vectors/*.json (all but tokens)
pnpm --filter @we/template-conformance record:tokens   # regenerate vectors/tokens/*.json — needs Chrome
pnpm --filter @we/template-conformance test            # vectors.test.ts + coverage.test.ts + encode.test.ts
pnpm --filter @we/template-conformance typecheck
```

`record:tokens` launches the installed Chrome (`WE_CHROME`, default `/usr/bin/google-chrome`) via
playwright-core, the same way `packages/app-shell/tests/browser` and `we-render` do. It serves the
real token/theme stylesheets, applies each theme through `applyThemeVars`, and reads
`getComputedStyle`. It is **not** part of `pnpm test` — the vitest run has no browser. It must be
run _before_ `pnpm record` for `style.json`'s computed values to resolve.

Navigation and render vectors mount real Solid on jsdom (a RouteStore over real history; the
renderer itself), so `pnpm record` is two steps: `tsx src/record.ts` writes eight files, then
`vitest.config.record.ts` runs `tests/record-navigation.test.tsx`, `tests/record-render.test.tsx`
and `tests/record-profiles.test.tsx` (excluded from the default projects on purpose), which write
`vectors/navigation.json`, `vectors/render.json`, `vectors/safety.json` and `vectors/profiles.json`.

## Files

```
vectors/expressions.json    expression source + env → result, plus the printer's round-trip
vectors/functions.json      built-in function name + args → result
vectors/paths.json          resolvePath(to, current, base) + isRelativePath
vectors/navigation.json     scripted route-store ops → href, page identity, history depth/index
vectors/render.json         template + data + events → rendered tree and actions fired, per step
vectors/query-compile.json  resolveQueryProp / pruneUnresolvedWhere / scopeIsAnchored
vectors/host-functions.json host source name + options → result
vectors/style.json          DS props + theme → emitted style + per-prop token & computed value
vectors/tokens/<theme>.json every --we-* custom property's computed value, per theme (6 files)
vectors/profiles.json       a world + an address + a capability-profile action → state before/after, events
vectors/validate.json       a document → valid, and each error's path as segments
vectors/safety.json         a template + its grants + events → tree, actions and confirmations, per step
vectors/panels.json         panel declarations + an address → panels present; three rungs → a placement
```

`validate.json` and `panels.json` are recorded by `tsx src/record.ts`; `safety.json` mounts real
Solid like `render.json` and is written by `tests/record-render.test.tsx`. The formats are in
`docs/spec/template/conformance.md`.

## Formats

Every file is `{ "version": 1, "cases": [ … ] }` (`expressions.json` adds an `envs` map).
Cases always carry `id` — stable, unique, what a failure message names — and `note`, a line
saying what the case pins.

### Value encoding

Values that are not JSON get a single-key marker object:

| encoded                      | decoded                                          |
| ---------------------------- | ------------------------------------------------ |
| `{"$undefined": true}`       | `undefined`                                      |
| `{"$nan": true}`             | `NaN`                                            |
| `{"$number": "Infinity"}`    | `Infinity` (`"-Infinity"` negative)              |
| `{"$callable": "<name>"}`    | a function (name informative; decodes to a stub) |
| `{"$namespace": {…members}}` | `namespace(prop => members[prop])`               |
| `{"$namespace": true}`       | an opaque namespace (output position only)       |

Everything else is its JSON self; **key order is authored order** (`JSON.parse`/`stringify`
preserve it). `null` and `undefined` are different things — the where-language treats them
differently.

### expressions.json

`{ id, note, source, env?, result, print }` or `{ id, note, source, env?, error: "syntax",
message, span }` when the source must not parse. `env` names an entry in `envs` (already encoded).
Evaluating: `evaluateExpression(parseExpression(source), env)` where `env.root(name)` answers
`{bound, value}` and `env.call(name, args)` dispatches to the built-in registry first and the
host's `$sources` second (a source takes `args[0]` as its options object). `print` is
`printExpression` of the same parse — reprinting must reproduce it.

### functions.json

`{ id, note, fn, args, context?, result }` — `getFunction(fn).impl(decode(args), {context,
stores:{}})`; `context` appears when the case supplies `$localMeta`/`$localScopeFields` (the form
functions). An impl that throws records `{"$error": "<message>"}`.

### paths.json

`{ id, note, to, current, base: {depth, root}, result, relative }` — `result` is
`resolvePath(to, current, base)`; `relative` is `isRelativePath(to.trim())`. `depth` = segments
the node's route spans; `root` = segments the template root spans (2 inside `/space/:id`).

### navigation.json

`{ id, note, schema, start, steps, expect }`. `schema` is the screen's declared params
(screen-state.md §4.3) — `{params: {name: {type, identity?, push?}}}`; `id` is the identity param.
`steps` are ops run against a mounted RouteStore over real history:
`open{href}`, `navigate{to, options?{query, base, replace}}`, `set_param{name, value, push?}`,
`sync_param{name, value, initial, type, push?, persist?}`, `local_read{name, persist?, initial,
type}`, `back`, `forward`. `expect` is one entry per step:
`{href, pageIdentity, depth, index, resolved?}` — `href` is `pathname+search+hash`, `pageIdentity`
is `routeStore.page()` (path + `?id=`), `depth`/`index` are the script's own history stack (1-based
depth, 0-based position), `resolved` is only on `local_read` (the syncParam precedence answer).

`sync_param` mirrors `$localState`'s write path: JSON-encode non-strings, and a value equal to the
declared `initial` (JSON-compared) removes the param. `local_read` answers the mount-time
precedence: URL param > `we-local:<persist>` > `initial`.

### render.json

`{ id, note, template, data?, actions?, gated?, params?, storage?, identities?, start?, steps?,
expect }` — the inputs are described in `src/cases/render.ts`. The template renders through the real
renderer after the host's part expansion; a template with `routes` renders under a router opened at
`start`. `steps` are `click{target}`, `input{target, value}`, `emit{target, event, detail?}`,
`navigate{to}` and `data{store, member, value}`; `target` is an element's `data-case`. `expect` has
one entry for the mount and one per step: `{ tree, actions, params?, storage? }`.

`tree` is renderer-neutral: `{ type, props?, slot?, children? }` per node (`type` as the template
wrote it; `props` what the renderer handed over, handlers left out), `{ slot, children }` for a named
slot a component received, a string for text, `{ missing: type }` for the missing marker drawn for an
unknown component and `{ missing: type, reason }` for the other causes (`unknown-element`,
`missing-definition`, `cyclic-definition`), and `{ type: '$surface', children }` for a responsive boundary. The renderer's own box-less wrappers
are not in it. Layout components (`Column`, `Row`, `Card`, `Grid`, `PartFrame`, `PanelLane`) are
probes drawing only their props and children; what a component does with its props is its own
contract. `actions` are the store methods called during the step, in order: `{ call, args }`.
`gated` methods go through the host's gesture gate, so one called with nobody having asked is absent.

### query-compile.json

`{ id, note, op, … }`. `op` selects the export under test: `query` carries `query` → `descriptor`
(`resolveQueryProp({$query})`), `where` carries `where` → `pruned` (`pruneUnresolvedWhere`),
`scope` carries `scope` → `anchored` (`scopeIsAnchored`).

### host-functions.json

`{ id, note, fn, options, result }` — `hostSourceBag()[fn](decode(options))`. Host sources take a
single options object — `options`, not an args list.

### style.json

`{ id, props, theme, direction, style, resolved }`. `style` is `buildLayoutStyles`'s emitted
declaration object verbatim. `resolved` is per authored prop:

- `{ "token": "<value>", "var": "--we-x", "px"|"color"|"value": <computed> }` — the value emitted
  a bare `var(--we-*)`; the third field is that var's computed value in `tokens/<theme>.json`.
- `{ "raw": "<css>", "computed": "<css>" }` — raw CSS; `computed` has every `var(--we-*)`
  substituted from the token table (fallbacks honoured).

Props the resolver does not consume (`styles`, state bags, tiers) may appear in `props` without a
`resolved` entry.

### tokens/\<theme\>.json

`{ "theme": "<id>", "vars": { "--we-x": "<computed>" } }` — every `--we-*` custom property that
applies to `document.documentElement` after `data-we-theme` + `applyThemeVars(overrides)`, read
from `getComputedStyle`. `var()` references inside a value are already substituted by the engine;
what each var records beyond that is decided by what its value _is_, not its name:

- **colour** (`CSS.supports('color', v)`): the serialised colour — `oklch(…)`, `rgb()`/`rgba()`,
  `color(srgb …)` — probed through a real `color` declaration so `calc()`, relative `oklch(from …)`
  and `color-mix()` come out evaluated.
- **length** (`CSS.supports('scroll-margin-left', v)`): its px resolution as a `"<n>px"` string —
  `rem`/`em`/`calc()` resolved against the 16px root font size (`--we-space-400` → `"16px"`,
  `--we-letter-spacing-tight` → `"-0.4px"`). `px` is the unit in the JSON; parse the number.
  `%`-valued vars (`--we-radius-full` → `"50%"`) are not lengths here — they record their text.
- **number** (`CSS.supports('scale', v)`): the number as text, calcs evaluated
  (`--we-color-lightness-500` → `"0.6"`, `--we-font-weight-600` → `"600"`, `--we-z-modal` → `"300"`).
- **anything else** keeps its computed text: shadows (`"0 1px 2px color-mix(in srgb, oklch(…) …)"`),
  gradients, font stacks, `"150ms"`, `"ease-out"`, `"none"`.

**Precision.** In a colour, length or number, every number is rounded to four decimal places,
trailing zeros trimmed and `-0` written `0` (`oklch(0.925 0.0338 288)`, `"13.3333px"`), so the
tables depend on the themes and not on the Chrome version that recorded them; Chrome's sixth
significant digit moves between releases. Text kept as computed is not rounded. Compare at the same
precision. `src/tokenPrecision.ts` holds the rule and the reasoning for four.

`--we-theme-*` vars are a theme's heterogeneous inputs — colours, lengths and numbers each record
by the rules above. The six ids: `light`, `dark`, `black`, `retro`, `cyberpunk`, `glow` (the
bundle's own theme; `glow` counts as a preset in coverage).

### profiles.json

The capability profiles' vectors, in their own format: `{ version, profiles, worlds, entities,
cases }`, each case a world, an address and one profile action (or none, for a read), with what the
host's state reads before and after it and the events it caused. The format and how a host runs it
are `docs/spec/profiles/README.md#conformance`. Recorded on WE's real stores, composed and booted on
the in-memory backend by `app-shell/tests/support/profileHost.tsx`; `tests/profiles.test.tsx` runs
every vector from the file again, and `tests/profilesCoverage.test.ts` holds every action and state
member of every profile to some case. A full run boots the host once per case, about two seconds each.

## For Rust implementers

Load each file, decode values through the marker table above (all other values
are already plain JSON). Environments for expressions come from `envs[name]`; roots are the map's
keys — a missing root is unbound. `env.call` semantics are: built-ins by name first, then host
sources taking `args[0]`. Nothing in these files needs a browser except the already-computed
values in `tokens/*.json`.
