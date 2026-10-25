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
| `boot.ts`                               | The sign-in screen, around the host's `CredentialField`                                              |
| `themes.ts`                             | Coasys, Josh's theme, with a light and a dark side; Coasys Glow, Nico's, dark only                   |
| `assets/BricolageGrotesque-latin.woff2` | Glow's typeface (SIL OFL 1.1), carried in its `fontFaces` as a `data:` URL                           |
| `app.ts`                                | The chrome around every space: one rail, no module rail                                              |
| `space/shell.ts`                        | A space as one tree and one view, on a home lane                                                     |
| `space/tree.ts`                         | The tree: channels, calls, flows, people, Social DNA                                                 |
| `space/views.ts`                        | A channel as chat or canvas, the flows, and a call's own page                                        |
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

Some of Nico's design is not reachable yet: the mint bar on the selected tree row (the tree's own
styling), and the d12 flow diagrams and proposal cards, which are features of their own rather than a
look.

## What is drawn and what waits

The identity pages in Settings (security, devices, bots, plan) are WE's own, drawn as "Coming soon"
until a backend reports it can do them. The Coasys way in — passkeys, a master key, linking a
device — waits on the same backend and will arrive as more states of `boot.ts`.
