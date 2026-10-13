# Apps as data

A **bundle** is a whole app as JSON: the app around every space, the space templates and sections it
renders with, a theme, the kinds of record it is about, and how it wants spaces shown. A deployment
builds bundles in through its seed; a person installs one from a file. "Cartridge" is the
conversational name — this is the literal one.

**A bundle cannot bring code.** It names modules and cannot ship one; a module this build does not
have is a part of the app that stays empty, and the install prompt says so. Everything else in it is
data the host already understands.

## The format

`readBundle` in `@we/schema-shared` (`src/bundle.ts`) is the reader and the definition:

| Field                                   | What it is                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `format`, `formatVersion`               | `we-bundle`, `1`. Checked before anything else.                                                 |
| `id`, `version`                         | The app's own. Lowercase with single dashes; an install is recognised by the id.                |
| `name`, `description`, `icon`, `author` | `author` is a claim — a file attests nothing.                                                   |
| `app`                                   | A template with `meta.role: 'app'`: the chrome around every space (see `chrome-and-panels.md`). |
| `templates`                             | Space templates (no role) and sections (`meta.role: 'view'`).                                   |
| `theme`                                 | `{ id, name, icon?, overrides, css? }`, the parameter object a theme is.                        |
| `recordTypes`                           | `{ name, icon?, description?, manifest }`, one entity each, as the model wizard writes it.      |
| `display`                               | `{ spaces: 'ours' \| 'theirs', template? }` — see "How an app shows spaces".                    |

**What a bundle needs and what it can do are not in it.** `judgeBundle`
(`app-shell/src/shared/bundles/judgeBundle.ts`) works both out from its templates — the app at the
chrome tier it is drawn with, everything else at the space tier — and validates its record types. A
list an author writes is a claim; an install prompt shows only what the walk found.

`bundles/` at the repository root holds the two checked in, the field guide and the tool library,
written by `pnpm --filter @we/template-cartridges bundle` from the spike's cartridges.

## Two routes in, one way to land

`bundlePieces` (`shared/bundles/bundlePieces.ts`) is the one function both routes go through. Every
piece is put under the bundle's id (`field-guide--species`), so a second install updates the same
records and nothing can take a built-in's id; every template is stamped `source: { bundle, version,
piece }`; and references to the bundle's own pieces (`meta.themeId`, `display.template`) are rewritten.

**Built in, from the seed.** `bundles: ["field-guide"]` in `we-seed.json`, and `generate-bundles`
writes them into the build. Their app, templates, sections and theme join the built-in registries —
read-only, forkable, updated by every deploy, nobody asked. The first one bringing an app is the
deployment's app unless `host.ui.app` names another. Its sections are available but not defaults.

**Installed, from a file.** Settings → Appearance → Apps. `bundleStore.installFromFile` reads and
judges the file and raises the host's prompt (`core:bundlePrompt`, a protected slot): provenance,
what it adds, what it can do, modules it turns on and modules this deployment lacks, its record types
for this space, and how it shows spaces. Confirming writes the app, templates and theme into the
agent's library, turns its modules on, records what it wrote in `AgentSettings.installedBundles`, and
makes its app the one in use. What an app brought is that app's: its templates are read-only, so
editing one forks it, and it is removed with the app.

## Whose is what

| Piece                       | Belongs to | So                                                                         |
| --------------------------- | ---------- | -------------------------------------------------------------------------- |
| App, space templates, theme | The person | In their library; another member of the same space may be in another app.  |
| Record types, sections      | The space  | Added to one by whoever runs it ("Set up this space"), for everyone in it. |

**Setting a space up** adds the app's record types (`shapeStore.addRecordTypes`, recognised by
`shapeId: we://shapes/bundle/<id>/<name>` so it never adds one twice) and switches its sections on.
An installed app's sections are first **copied into the space**, because a section switched on is a
section every member is shown, and they live only in one person's library. An install does this for
the space on screen when its installer runs it; anywhere else it is a button in Settings.

**Removing an app** removes its app, templates and theme. Never its record types, which hold what
people made with it, in spaces other people share — and never the sections a space was set up with,
which are the space's by then.

## How an app shows spaces

The display policy belongs to the app in use, not to a setting. An app whose bundle says
`spaces: 'ours'` opens every space the agent follows with the bundle's space template; `theirs` leaves
each space its own. A template the agent pinned for one space still wins there. Switching back to
WE's app chooses again, falling back to the agent's default template — nothing was written, so
nothing has to be undone (`shared/bundles/display.ts`, used where `TemplateStore` picks a space's
template).

## Not yet

Bundles from the marketplace, with an author behind them. Upgrades and re-consent (an install of a
newer version is an update in place today, and says so). Subscribed versus forked. Grants narrower than
a tier. Bundles at the space-template and section layer — the format leaves room, since an app is
optional.
