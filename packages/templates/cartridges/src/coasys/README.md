# Coasys

The Coasys app as a cartridge: WE whitelabelled, with nothing of WE's own code changed. A deployment
builds it in with `seeds/coasys.seed.json`; anybody can install `bundles/coasys.bundle.json` from a
file in Settings.

| File                                    | What it is                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `index.ts`                              | The cartridge: what it brings, the modules it needs, how it shows spaces                             |
| `brand.ts`                              | The name, the mark and the About page                                                                |
| `assets/mark.svg`                       | The Coasys logo as the app draws it — the bundle reads it                                            |
| `assets/icon.svg`                       | The desktop icon: the logo on Glow's indigo tile — the seed names it, `@we/brand` renders every size |
| `boot.ts`                               | The sign-in screen: WE's sign-in form and accounts as parts, in Coasys's frame                       |
| `themes.ts`                             | Coasys, Josh's theme, with a light and a dark side; Coasys Glow, Nico's, dark only                   |
| `assets/BricolageGrotesque-latin.woff2` | Glow's typeface (SIL OFL 1.1), carried in its `fontFaces` as a `data:` URL                           |
| `app.ts`                                | The chrome around every space: one rail, no module rail                                              |
| `firstRun.ts`                           | "Welcome to Coasys": make your identity here, or start without one                                   |
| `space/shell.ts`                        | A space as one tree and one view, on a home lane                                                     |
| `space/tree.ts`                         | The tree: channels, calls, workflows, people, Social DNA                                             |
| `space/views.ts`                        | The pages: the Feed, the workflows, and a call's own page                                            |
| `space/canvas.ts`                       | Canvas mode: the space's canvas, dimmed to what the tree has chosen, and the vocabulary map          |
| `space/bar.ts`                          | The bar over every view, with the Page / Canvas switch at its end                                    |
| `space/lockup.ts`                       | The mark and name, where the rail and the sign-in screen both draw them                              |
| `space/paths.ts`                        | The addresses the tree and the views share                                                           |
| `space/marks.ts`                        | The live dot and the count pill the tree and the views share                                         |

After any change, write the bundle again and check it in:

```bash
pnpm --filter @we/template-cartridges bundle
```

`cartridges.test.ts` fails when the checked-in bundle has drifted from this source.

## Glow and the space

Glow is Nico's coasys.org look as settings: the site's surfaces pinned, mint and its pastels as colour
settings, tints mixed into the surface as the site's are, light headings and tracked eyebrows as type
roles, the three orbs as the page's image, and a strong glow. The space asks for the effects and the
theme decides how strong they are, so the same templates read quietly under Josh's Coasys theme:

- eyebrows (`overline`) over the tree and the first steps;
- the first thing to do lit with an accent border and `shadow: 'glow'`;
- a glowing dot for a call running, and the Live tag;
- counts as pills;
- a dot grid on the canvas;
- page titles in the heading role, with no weight of their own.

The mint bar on the selected tree row is the tree's `selected` variant, which Glow sets
(`components.tree.variants.selected`). Not reachable yet: the d12 flow diagrams and proposal cards,
which are features of their own rather than a look.

## Page and Canvas

The tree chooses what is in focus; the switch at the end of every bar says where to see it. Page opens
the chosen thing's page. Canvas shows the space's canvas with that focus applied — a call dims what
was not extracted from it, a person what they did not make, a workflow what is not going through it —
or, for anything of Social DNA, the vocabulary map with that lit. The two maps stay apart: the canvas
is what the space holds, arranged by people; the vocabulary is what it has defined, laid out by itself.

The mode is `?view=canvas`, which every navigation the space makes carries (`withView` in
`space/paths.ts`), so it stays on while somebody moves around the tree. The canvas is drawn beside the
pages rather than as a route, so a change of focus restyles it rather than drawing it again. The focus
rules and the vocabulary map are the kit's (`focusDim`, `focusDimWhere`, `vocabularyMap`), shared with the
workshop.

## What is drawn and what waits

The identity pages in Settings (security, devices, bots, plan) are WE's own, drawn as "Coming soon"
until a backend reports it can do them. Lit up so far: the key log (Security → Key log) and the
device list, read from the executor's `identity.*` calls, and — on the desktop app, whose shell
keeps the master key — Add a device and Revoke, which open the shell's identity window.

Two screens come before a space. WE's sign-in form, which `boot.ts` places, gets a session. Then,
once the session is ready, the first run (`firstRun.ts`) sits over the rail while
`identityStore.needsFirstRun`. Its other doors (log in with a Coasys account, link to an identity,
the 12 words) are drawn "Coming soon" until the flows behind them are added.
