# The acceptance world

End-to-end scenarios that drive the real apps as a person does, in a world built for the run. Each
scenario starts a fresh local world, acts only through the apps' windows, and ends with a scan of
everything it touched for the secrets it saw.

`pnpm test` runs the unit tests of the harness itself (`test/`). The scenarios need built apps and an
ad4m checkout, and run with `pnpm --filter @we/acceptance acceptance`. CI runs them every night
(`.github/workflows/acceptance.yaml`); a failed run opens an issue. It is a notice, not a required
check.

## What a run does

```text
cli ─ runner ─┬─ local world: identity-store (temp database), executors, from AD4M_REPO
              ├─ X display: Xvfb, its framebuffer in a file (the screenshots)
              ├─ desktop driver ── harness link (TCP, loopback, token) ── the app's harness build
              │                                                         ├─ main window
              │                                                         ├─ identity window
              │                                                         └─ custody service
              └─ secret ledger ── scan of logs, data folders and window text
```

- **The local world** (`src/world/`): an `identity-store` on a temporary database, and the
  executors a scenario starts, from the ad4m checkout the run names. The executors run as ad4m's
  own identity suite runs them: from its seed, with the centralised agent language and the shared
  test language folders, without Holochain. Every process is in its own process group, and the world
  fails the scenario if one is still running after it stops.
- **Names and origins** (`src/world/names.ts`): each service has a `.test` name in the local world
  (`store.coasys.test`, `host-<name>.test`) beside its production name, and a world refuses an
  endpoint that names a production service. The world does not serve these names yet: no scenario
  that is on needs two sites. The local edge (a TLS proxy with a test certificate authority) comes
  with the first web scenario.
- **The session** (`src/session.ts`): a run is its own D-Bus session (`dbus-run-session`) with its
  own runtime folder, so no service the bus starts finds the person's own keyring. Each app the
  driver launches gets a session bus of its own inside it, in the app's runtime folder, so what one
  app's bus starts on demand (the desktop portal, a Secret Service) is gone before the next app.
- **The desktop driver** (`src/drivers/`): starts the desktop app's harness build on the run's X
  display, with a fresh home and data folder, and waits for it to dial the harness link. The app is
  the Electron app, the desktop app WE ships, unless the run says `--host tauri`. Both hosts speak
  one protocol (`apps/we-electron/electron/harness.js`, `apps/we-tauri/src-tauri/src/harness.rs`),
  so a scenario does not know which it drives; where they differ (Electron names its IPC channels
  `identity-flow-start` where Tauri says `identity_flow_start`), the driver hides it. Electron runs
  unpackaged, since a package leaves the harness out, with its built renderer, a user-data folder of
  its own and `--ozone-platform=x11`, and starts its own executor and custody sidecar as in
  production. Where Chromium's sandbox cannot start (Ubuntu 24.04 refuses unprivileged user
  namespaces, and `chrome-sandbox` in `node_modules` is not setuid root), the driver says so and
  runs the app with `--no-sandbox`; CI makes the helper setuid, so the run there is sandboxed. An
  app that leaves a process naming its folder running after it stops fails the scenario. A scenario
  then acts in the main window and the identity window as a person: it reads the text on screen,
  presses a control by its words (or by its icon, where it has no words), types into a field by its
  label. The harness build adds no command and no capability to the app; it reaches the windows
  from the app's own process (Electron's main process, or WebKitGTK in the Tauri app).
- **The vault**: the app keeps custody items in memory by default (`vault: 'memory'`), so a run
  leaves nothing in a keyring; `vault: 'os'` uses a Secret Service on the app's own bus, from a
  `gnome-keyring-daemon` the driver starts and unlocks. On Linux the person types the passphrase in
  the identity window either way; there is no OS prompt for the harness to answer.
- **Scenarios** (`src/scenarios/`): each says what it proves, where it runs, and whether it is on or
  pending. A pending scenario says what it needs; it does not run, and the report lists it. The
  change that makes it pass turns it on. A scenario that is on lists the steps it names but cannot
  take yet, with the reason.
- **The secret ledger** (`src/secrets.ts`): every secret a scenario sees — the words, the
  passphrase, the account password, the offer link — goes into the ledger. After the scenario, the
  scanner looks for each in every form a file could hold it (as typed, base64, hex, JSON) in the
  world's logs and data folders and the window text kept for each step. The 12 words are found as
  any run of four of them in the phrase's order with anything but letters between them (spaces,
  newlines, the numbers a screen puts beside them); a single word is not a finding. A finding fails
  the scenario. The scan reads bytes, not pixels, so it cannot read a screenshot: a step that ends on
  or passes through a screen with a secret on it (the words, the offer link) declares `shows`, and
  then keeps no screenshot and no window text, whether it passes or fails; the report says why.
  `test/rules.test.ts` fails a step that reaches such a screen without `shows`.
- **The report** (`results/<time>/`, or `--out`): `summary.md` and `report.json`, and per scenario
  a screenshot and the window text after each step that does not declare `shows`, its notes and its
  scan.
  The report is what a run publishes, so every secret in the ledger is redacted from a failure
  before the report, the console or an issue holds it. A step that shows a secret keeps only the
  first line of its failure, not the window text after it. A kept file in which the scan finds a
  secret is removed, and `scan.json` says where it was. The world's own folder (logs, data folders)
  is removed when a scenario passes and kept, named in its notes, when it fails.

## The scenarios

`pnpm --filter @we/acceptance acceptance --list` lists them and their state.

| Scenario                                                                                                                                | State                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-an-identity`                                                                                                                      | On. Desktop first run: an account, "Make my identity here", the 12 words, two checked (a wrong answer refused), a passphrase (a short one refused), the identity ready as d1; then Settings shows this computer as d1 and the key log's first event; only the identity window ran the identity flow. |
| `make-an-identity-os-vault`                                                                                                             | On. The same first run with the session's Secret Service as the vault (`vault: 'os'`), and a check that the custody item rests there, not in a file.                                                                                                                                                 |
| `add-and-revoke-a-device`                                                                                                               | On. After the first run, a server started for the person (`--operator`) claims the offer link from Settings → Devices → Add a device; both show the same match code; the person confirms; the server is d2. Then the person revokes d2. A wrong passphrase is refused at each unlock.                |
| `start-now-then-identity`, `link-a-second-desktop`, `link-a-phone`, `restore-with-words`, `replace-the-master-key`, `log-out-only-copy` | Pending, each with its reason.                                                                                                                                                                                                                                                                       |

## Run it on a computer

Linux with Xvfb, `dbus-run-session` and (for `vault: 'os'`) `gnome-keyring`. Then:

1. An ad4m checkout at the commit WE pins (`node scripts/ad4m-pin.mjs --commit`), with:

   ```sh
   cargo build --release -p ad4m -p identity-store --bin ad4m-executor --bin identity-store
   cd tests/js && pnpm run prepare-test-local
   ```

2. The Electron app, for the Coasys seed, starting that checkout's executor, and the custody
   sidecar's harness build (`crates/custody/README.md`):

   ```sh
   export AD4M_REPO=<ad4m> WE_SEED=seeds/coasys.seed.json
   AD4M_EXECUTOR=$AD4M_REPO/target/release/ad4m-executor pnpm --filter '@we/app-electron...' build
   (cd crates/custody && cargo build --release --locked --bin we-custody --features harness)
   ```

   The run refuses to start when the app names another executor, or the sidecar beside the app is
   not the harness build, and says what to run. A launch refuses while another process holds port
   9080, where the app serves its renderer: beside another WE the app stops in Electron's error box
   and never answers.

3. The scenarios:

   ```sh
   AD4M_REPO=<ad4m> pnpm --filter @we/acceptance acceptance [--only make-an-identity]
   ```

The Tauri app is driven too, so it keeps working. Its harness build, against the same checkout:

```sh
export AD4M_REPO=<ad4m> WE_SEED=seeds/coasys.seed.json
pnpm --filter '@we/app-tauri...' build
cd apps/we-tauri/src-tauri && node ../scripts/generate-seed-config.cjs
CARGO_TARGET_DIR=$AD4M_REPO/target cargo build --release --features harness,tauri/custom-protocol
cd - && AD4M_REPO=<ad4m> WE_HARNESS_APP=$AD4M_REPO/target/release/we \
  pnpm --filter @we/acceptance acceptance --host tauri
```

`CARGO_TARGET_DIR` is optional; with ad4m's target folder, the executor's crates are not built twice.

`pnpm --filter @we/acceptance explore` starts a world with the app in it and keeps it running, for
writing a scenario: it reads commands on standard input (`main return h.inventory()`, `text
identity`, `shot screen.png`, `quit`).

| Variable             | What it names                 | Default                                     |
| -------------------- | ----------------------------- | ------------------------------------------- |
| `AD4M_REPO`          | the ad4m checkout             | `../ad4m` beside this repository            |
| `AD4M_TARGET_DIR`    | where its binaries are        | `$AD4M_REPO/target`                         |
| `AD4M_EXECUTOR`      | the executor binary           | `$AD4M_TARGET_DIR/release/ad4m-executor`    |
| `WE_ELECTRON_APP`    | the Electron app's folder     | `apps/we-electron`                          |
| `WE_HARNESS_APP`     | the Tauri app's harness build | `apps/we-tauri/src-tauri/target/release/we` |
| `ACCEPTANCE_VERBOSE` | print every process's output  | off                                         |

## Rules for a scenario

- Act through the apps. World building ends with `ctx.worldBuilt()`; after it, the only executor
  calls a scenario makes are reads for its assertions (`identity.status`, `identity.log`).
  `test/rules.test.ts` fails on any other.
- Record every secret the scenario sees in `ctx.secrets`, before it can reach a file.
- A step that shows a secret on purpose says so (`{ shows: 'the 12 words' }`), and so does a step
  that ends on such a screen without meaning to (the first-run step, which opens on the words). A
  screenshot is pixels, which the scan cannot read, so nothing else stops one from being published.
- A wrong answer a scenario types on purpose is never part of a secret (not one of the 12 words).
- No scenario runs on Windows or touches production.
- A scenario does not rerun after a failure.

## Not here yet

- The local edge and its `.test` names served over TLS; the web and `coasys.id` drivers.
- The phone driver.
- A world clock: no scenario that is on moves time.
- The harness commands that later steps need: deep links, a scanned QR code, a clock offset, a
  signal to the executor.
- A release guard in CI that fails when a release build holds harness code. Today the Tauri app
  and the custody sidecar hold it only with their `harness` feature (`#[cfg]`), which a release
  build does not turn on; the Electron package leaves `electron/harness.js` out, and the app
  imports it only when not packaged (`apps/we-electron/electron/harness.test.js`).
