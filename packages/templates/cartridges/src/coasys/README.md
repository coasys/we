# Coasys

The Coasys app as a cartridge: WE whitelabelled, with nothing of WE's own code changed. A deployment
builds it in with `seeds/coasys.seed.json`; anybody can install `bundles/coasys.bundle.json` from a
file in Settings.

| File              | What it is                                                                |
| ----------------- | ------------------------------------------------------------------------- |
| `index.ts`        | The cartridge: what it brings, the modules it needs, how it shows spaces  |
| `brand.ts`        | The name, the mark and the About page                                     |
| `assets/mark.svg` | The mark — the bundle reads it, and the seed names it as the desktop icon |
| `boot.ts`         | The sign-in screen, around the host's `CredentialField`                   |
| `themes.ts`       | Coasys, Josh's theme, with a light and a dark side                        |
| `app.ts`          | The chrome around every space: one rail, no module rail                   |
| `space/shell.ts`  | A space as one tree and one view, on a home lane                          |
| `space/tree.ts`   | The tree: channels, calls, flows, people, Social DNA                      |
| `space/views.ts`  | A channel as chat or canvas, the flows, and a call's own page             |
| `space/paths.ts`  | The addresses the tree and the views share                                |

After any change, write the bundle again and check it in:

```bash
pnpm --filter @we/template-cartridges bundle
```

`cartridges.test.ts` fails when the checked-in bundle has drifted from this source.

## What is drawn and what waits

The identity pages in Settings (security, devices, bots, plan) are WE's own, drawn as "Coming soon"
until a backend reports it can do them. The Coasys way in — passkeys, a master key, linking a
device — waits on the same backend and will arrive as more states of `boot.ts`.
