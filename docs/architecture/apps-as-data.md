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

| Field                                   | What it is                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `format`, `formatVersion`               | `we-bundle`, `1`. Checked before anything else.                                                             |
| `id`, `version`                         | The app's own. Lowercase with single dashes; an install is recognised by the id.                            |
| `name`, `description`, `icon`, `author` | `author` is a claim — a file attests nothing.                                                               |
| `app`                                   | A template with `meta.role: 'app'`: the chrome around every space (see `chrome-and-panels.md`).             |
| `templates`                             | Space templates (no role) and sections (`meta.role: 'view'`).                                               |
| `pages`                                 | Pages of the app's own (`meta.role: 'page'`) — an About page, a guide. See "Pages".                         |
| `theme`                                 | `{ id, name, icon?, overrides, css? }`, the parameter object a theme is.                                    |
| `themes`                                | The same, for an app offering several looks, its default first. A bundle uses one or the other.             |
| `brand`                                 | `{ name, mark?, wordmark?, about?, aboutPage? }`: what the app calls itself. See "Whitelabelling".          |
| `bootScreen`                            | A node: the app's own sign-in screen, placing WE's sign-in form or the host's `CredentialField`. See below. |
| `recordTypes`                           | `{ name, icon?, description?, manifest }`, one entity each, as the model wizard writes it.                  |
| `display`                               | `{ spaces: 'ours' \| 'theirs', template? }` — see "How an app shows spaces".                                |
| `starters`                              | Space starters, as a seed's `spaceStarters` are: what a space made in the app begins with. See below.       |

**What a bundle needs and what it can do are not in it.** `judgeBundle`
(`app-shell/src/shared/bundles/judgeBundle.ts`) works both out from its templates — the app at the
chrome tier it is drawn with, and its pages with it, everything else at the space tier — and validates its record types. A
list an author writes is a claim; an install prompt shows only what the walk found.

`bundles/` at the repository root holds the two checked in, the field guide and the tool library,
written by `pnpm --filter @we/template-cartridges bundle` from the spike's cartridges.

## Two routes in, one way to land

`bundlePieces` (`shared/bundles/bundlePieces.ts`) is the one function both routes go through. Every
piece is put under the bundle's id (`field-guide--species`), so a second install updates the same
records and nothing can take a built-in's id; every template is stamped `source: { bundle, version,
piece }`; and references to the bundle's own pieces (`meta.themeId`, `display.template`,
`brand.aboutPage`, a starter's `defaultTemplateId` and `defaultThemeId`) are rewritten.

**Built in, from the seed.** `bundles: ["field-guide"]` in `we-seed.json`, and `generate-bundles`
writes them into the build. Their app, templates, sections and theme join the built-in registries —
read-only, forkable, updated by every deploy, nobody asked. The first one bringing an app is the
deployment's app unless `host.ui.app` names another. Its sections are available but not defaults.

**Installed, from a file.** Settings → Apps & templates. `bundleStore.installFromFile` reads and
judges the file and raises the host's prompt (`core:bundlePrompt`, a protected slot): provenance,
what it adds, what it can do, modules it turns on and modules this deployment lacks, its record types
for this space, and how it shows spaces. Confirming writes the app, templates and theme into the
agent's library, turns its modules on, records what it wrote in `AgentSettings.installedBundles`, and
makes its app the one in use. What an app brought is that app's: its templates are read-only, so
editing one forks it, and it is removed with the app.

**Installing a newer version** updates in place, and asks first like any install. An update must
not inherit consent it was never given, so the install record keeps what was agreed to — the
capability groups, module ids and record type names the prompt showed (`granted`, see
`shared/bundles/consent.ts`) — and the prompt for a newer version says what it asks for beyond them
first, or says it changes the app and can do nothing more; what was agreed already is folded away
under "What you already agreed to", so it never reads as something the update adds. Both sides come
from walking the templates, never from what a file says about itself, and groups are compared rather
than their wording, so rewording one never makes it look new. An install recorded before grants were
kept has nothing to compare against, and its update shows the full list as before.

**The same file again** changes nothing, so its prompt says the app is already installed and offers
only Close. Decided by content, not version — the install record keeps a digest of the file
(`bundleDigest`) — so a file whose author changed it without raising the version is still an update.

## Whose is what

| Piece                       | Belongs to | So                                                                        |
| --------------------------- | ---------- | ------------------------------------------------------------------------- |
| App, space templates, theme | The person | In their library; another member of the same space may be in another app. |
| Record types, sections      | The space  | Added to the spaces their installer runs and ticks, for everyone in each. |

**Setting a space up** adds the app's record types (`shapeStore.addRecordTypes`, recognised by
`shapeId: we://shapes/bundle/<id>/<name>` so it never adds one twice) and switches its sections on.
A space that already has a record type of the same name it did not get from this app is not set up
at all — sections reading somebody else's `Species` would draw its records as though they were this
app's — and says so. That is decided per space, never at install: installing writes only to a
person's library, so the install checks a record type's name against WE's own vocabulary alone.
An installed app's sections are first **copied into the space**, because a section switched on is a
section every member is shown, and they live only in one person's library. Which spaces is asked, as
a checklist of the spaces the installer runs (`bundleStore.spaceChoices`), with the one on screen
ticked to start with: the install prompt carries it, and Settings → Apps → "Set up a space…" opens
it on its own for an app already installed. Nobody is offered a space they do not run, and a space
already set up is shown as such rather than offered again.

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

## The first frame after a reload

The app, its templates and its theme live in the agent's library and settings, which answer seconds
after the app starts drawing — so a reload showed WE's chrome and then swapped to the app. A snapshot
of exactly those pieces is kept on the device per agent (`shared/bundles/bootSnapshot.ts`, written by
`BundleStore` once the library and settings have both loaded) and stands in for them until they
answer. Each template in it goes through the same acceptance as the library's, and safe mode ignores
it. When the display policy decides a space's template, that template is shown at once; reading the
space's own templates and the agent's override for it still has the last word.

## Pages

A page is what an app wants to say that is not about a space: its About page, a guide, a changelog.
It is a template with `meta.role: 'page'`, listed in `pages`, and it opens above everything as the
host's own settings and profile do — `shellStore.openShellView('<bundle id>--<page id>')`, from any
template — with its own router inside, so one page can hold sub-pages at paths of its own.

- **It is the app's chrome.** Judged and drawn at the chrome tier, as the app is; never offered as a
  space's template; never drawn in safe mode, where the id opens nothing.
- **Its id carries the bundle's**, so a page can never take one of the host's views.
- **`brand.aboutPage`** names the one the host's "About" opens (`landing-page`), in place of WE's
  About page or the brand's Markdown `about`. Give both and `about` is what a build without pages
  shows.
- A built-in bundle's pages join the registries (`seedBundlePages`); an installed one's are written
  to the library with its other templates and removed with them. `templateStore.bundlePage` finds
  either, and `resolveShellView` asks it first.

## Whitelabelling

An app can stand in for WE wherever WE names itself. While the app in use came in a bundle with a
`brand`, `templateStore.brand` is that brand: the sidebar's mark, the sign-in screen, the window's
title and favicon, the About page, and every sentence in the shell that names the product read it.
WE's own code is untouched — without a brand, everything says WE as before. Code that is not a
template (a toast, the failure screen) reads `currentProductName()` from `shared/bundles/brand.ts`.

- **Marks are SVG source, drawn as images.** Nothing in an image can run or load, and `readBundle`
  still refuses an SVG with script, event handlers, foreign HTML or a reference outside itself.
- **A sign-in screen of the app's own** (`bootScreen`) replaces `core:bootScreen`, in any layout,
  provided it has a way to type the password: the host's `CredentialField`, or WE's sign-in form,
  which holds it (see `protected-pieces.md`). `judgeBundle` judges it at the chrome tier, as the app
  is, and refuses one with neither. Like the app's chrome, it can be taken at three depths:
  - **WE's, whole** — bring no `bootScreen`, and the app's theme and brand dress WE's screen.
  - **WE's parts in a frame of the app's own** — place `host.signIn.form` (whoever is signing in and
    the step they are on) and `host.signIn.accounts` (the other accounts on this device), with the
    app's own surface, corner and decoration around them. The form's words change through its inputs
    (`unlockLabel`, `passwordLabel`), each defaulting to WE's. Every step of signing in, and every
    fix to one, arrives in the app's screen as it does in WE's. Coasys's is this (`coasys/boot.ts`).
  - **The app's own entirely** — its own steps, read from `sessionStore.signInStep` (one answer for
    which step is showing), around the host's `CredentialField`. It then keeps up with every new step
    itself, and a step it lacks draws nothing.
- **Before anybody has signed in**, the library is out of reach, so the device keeps the brand, the
  sign-in screen and the themes of the app it last ran (`shared/bundles/deviceApp.ts`), the way it
  keeps the default theme. A fresh install has nothing kept and uses the deployment's own app (the
  seed's). Safe mode ignores both and draws WE's.
- **Its themes.** A template names the themes it is designed for in `meta.themeIds`, its default
  first. Choosing the app makes its first theme the agent's default at that moment; the app's first
  theme also stands in for an agent who has never chosen one. A choice made afterwards wins.

A deployment that builds a bundle in (`seed.bundles`) is whitelabelled by it from the first frame;
what its desktop builds are called and installed as is the seed's `desktop` block, not the bundle's
(see `docs/getting-started/seed-system.md`).

## What a space made in the app starts with

A bundle's `starters` are space starters in the format a seed's `spaceStarters` take
(`spaceStarter.ts` in `@we/schema-shared`, which `readBundle` checks them against). A starter names
the bundle's own template and theme by their ids in the bundle (`"defaultTemplateId": "space"`), and
they land on the bundle's pieces (`coasys--space`).

A new space gets, in order:

1. the first starter of the bundle whose app is in use, when the seed builds that bundle in;
2. otherwise the seed's first, which is what WE's own app gets.

The app wins because a space made inside Coasys is meant to be a Coasys space. The create dialog says
so ("Starts as a Coasys space", with the starter's `description` under it) whenever the app's starter
is the one that applies, since a space is the community's and the app somebody happens to be in should
not decide its defaults silently. In WE's own app it shows nothing new.

**Only a built-in bundle's starter applies.** One installed from a file is somebody else's, and its
starter would write into every space made while in that app, for everyone in it, so it is ignored
until an install asks about that. A starter applies to new spaces only: changing one never changes a
space made from an earlier version.

A built-in bundle's record types are not built in, so its starter may only write records of the
space's own schema; the app shell's starter tests check every built-in starter the way `validate:seed` checks
a seed's.

## Not yet

Bundles from the marketplace, with an author behind them, and updates that reach a subscriber
without a file being installed again. Subscribed versus forked. Grants narrower than
a tier. Bundles at the space-template and section layer — the format leaves room, since an app is
optional.
