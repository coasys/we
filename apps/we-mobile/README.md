# Coasys phone app (`apps/we-mobile`)

WE on a phone: `org.coasys.app`, shown as "Coasys". A Capacitor 8 shell around WE's own web build
(`apps/we-web/dist`), copied unchanged. WE runs in the platform WebView and reaches its executor
with the WebView's own `WebSocket` and `fetch`, the same way it does in a browser. Nothing is
replaced or patched in.

The app adds one page of its own: the page Capacitor opens when the phone's Android System WebView
is too old to run WE, or when WE's page fails to load (`src/error/`).

Android is built and checked in CI (`.github/workflows/phone-app.yaml`). The iOS project is in the
tree, and `cap sync ios` works, but nothing builds it.

## How the phone connects (phase 1)

Through ad4m-connect, as the web app does (`apps/we-web/src/platform/ad4mConnector.ts`). On a
phone-sized screen it offers only **Remote Node**: pick a listed host or type a URL, then sign in or
register with email and password on that executor (a multi-user executor: a host or Coasys cloud).
The executor must be reachable over `https`/`wss` with a certificate the phone trusts. The release
build allows no cleartext (`android/app/src/main/res/xml/network_security_config.xml`).

The session is kept: a closed and reopened app is still signed in. The executor token lives in the
WebView's storage, like the web app's: Android's app sandbox protects it, nothing seals it further,
and the app opts out of backup and device transfer so it does not leave the phone.

## The device key and key login (phase 2a)

The phone has a key of its own, held by the `DeviceKey` plugin
(`android/app/src/main/java/org/coasys/app/devicekey/`) over `crates/phone-custody`, a Rust crate
built for Android with uniffi bindings:

- **The keys.** An Ed25519 device key (signing) and an X25519 key (for what is sent to the phone
  sealed), each a 32-byte seed. Each seed is sealed by an AES-256-GCM key in the Android Keystore,
  in StrongBox where the phone has one and the TEE otherwise, which never leaves it
  (`KeystoreKey.kt`; no user authentication, so a login asks nothing). The sealed seeds are in
  `no_backup/device-keys/device-keys.json`, which no backup or transfer includes. Only public keys
  and signatures cross into JS.
- **Joining an identity.** `join({link})` claims an offer a computer holding the identity's master
  key opened (`https://id.coasys.org/o#coasys:offer:1:…`); both sides show the same match code, the
  computer signs an `add` listing the phone's keys, and `waitJoined()` sees it land.
- **Key login.** Once the phone has joined and has an executor to log in to, WE logs in with the
  device key (`user.sessionChallenge` → a signed statement → `user.loginWithKey`) instead of showing
  the connect screen, and renews the session five minutes before each expiry
  (`apps/we-web/src/platform/deviceKeyConnector.ts`, `keySession.ts`). The token is never stored:
  every boot logs in afresh. Anywhere else, and on a phone that has not joined, WE connects as in
  phase 1.

Phase 2a has no screens for any of this. The executor to log in to is the localStorage key
`we-phone/key-host` (an http(s) URL), set by hand; joining is driven from DevTools:

```sh
node scripts/cdp-eval.mjs "JSON.stringify(await Capacitor.Plugins.DeviceKey.create())"
node scripts/cdp-eval.mjs "JSON.stringify(await Capacitor.Plugins.DeviceKey.join({link: '<offer link>', hint: 'My phone'}))"
node scripts/cdp-eval.mjs "JSON.stringify(await Capacitor.Plugins.DeviceKey.waitJoined({seconds: 120}))"
node scripts/cdp-eval.mjs "(localStorage.setItem('we-phone/key-host', 'http://127.0.0.1:<port>'), location.reload())"
```

`crates/custody/tests/live.rs`'s `a_phone_joins_through_an_offer` is the computer's side of that
run, against a throwaway store and executor. What phase 2b adds (linking screens, the master key,
the device inbox) is in [`docs/phase-2b.md`](docs/phase-2b.md).

## Build

From the repo root:

```sh
pnpm install
pnpm build:web                 # WE's web build: apps/we-web/dist
cd apps/we-mobile
pnpm build:web                 # www/ = apps/we-web/dist + the error page in www/mobile/
pnpm check:floor               # WE's scripts parse on the WebView floor; the error page parses on WebView 83
pnpm test                      # the floor and the error page's wording
pnpm exec cap sync android     # www/ and capacitor.config into android/
scripts/build-android-rust.sh  # crates/phone-custody for the phone, and its Kotlin bindings
cd android && ./gradlew :app:testDebugUnitTest assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Gradle needs JDK 21 and an Android
SDK (`JAVA_HOME`, `ANDROID_HOME`). The Rust half needs rustup (the crate's `rust-toolchain.toml`
picks the channel), `cargo install cargo-ndk`, and an NDK (`ANDROID_NDK_HOME`, 27 is what was used).
`testDebugUnitTest` runs the plugin's Kotlin over a host build of the same crate; the Keystore half
runs only on a device or emulator:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=org.coasys.app.devicekey.KeystoreSealerTest
```

(Name the class: Capacitor's template `ExampleInstrumentedTest` asserts another package name and
fails.)

## Run it on an emulator, or a phone over USB

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n org.coasys.app/.MainActivity
```

The emulator needs a system image whose WebView is at least the floor (below). An Android 11 image
ships WebView 83 and shows the update page; an Android 14 or 15 Google APIs image is new enough.

To test against an executor on your own machine, use a **throwaway** one with its own data
directory, never the executor you use. `packages/backend-system/ad4m/tests/live/executor.ts` shows
how; `node scripts/ad4m-executor.mjs --path` names the pinned binary. Run it multi-user
(`--enable-multi-user true`) on port 12600, then:

```sh
adb reverse tcp:12600 tcp:12600
```

and in the app choose **Connect to Remote Node**, type `http://127.0.0.1:12600` in the URL field,
**Connect**, then register with a test email and password. This works the same on an emulator and
on a phone plugged in over USB.

Two things make that work, and both are debug-only or loopback-only:

- `http://127.0.0.1` rather than `10.0.2.2` or a LAN address. WE's content security policy allows
  `http:` and `ws:` to loopback only (`packages/csp`). Use `127.0.0.1`, not `localhost`: Capacitor
  serves the app itself from `https://localhost` and answers every request to that host.
- `android/app/src/debug/res/xml/network_security_config.xml` allows cleartext to `127.0.0.1` and
  `localhost` in debug builds. A release build uses `src/main`'s, which allows none.

For a key login, forward the executor's own port to the same port (`adb reverse tcp:P tcp:P`): the
signed statement names the origin the phone dials, and an executor with no `--public-origin`
accepts only its own loopback origins on its own API port. The offer link names the identity store
by its URL, so forward the store's port the same way.

To read or drive the WebView without tapping (a debug build enables WebView debugging):

```sh
node scripts/cdp-eval.mjs "location.href"
node scripts/cdp-eval.mjs --page error.html "document.body.innerText"
```

## The WebView floor

`MIN_WEBVIEW_MAJOR` in `src/webViewFloor.ts`: **121**. Capacitor reads it as
`android.minWebViewVersion` and, on an older Android System WebView, opens the error page instead
of WE, which says "Update Android System WebView" and links to it in the Play Store. Without it an
old WebView shows a blank screen. The same page is opened when WE's page fails to load; it tells the
two apart by the WebView version in the user agent.

How 121 was found: WE's build was loaded in Chrome for Testing 113, 117, 118, 119, 120, 121 and 122,
and in Chrome 156, through Playwright, and the page's computed colours and errors compared.

| Chrome / WebView | What happens                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 83               | Nothing renders. The bundle does not parse: `Unexpected token '='` (logical assignment, Chrome 85).            |
| 113–118          | Loads with no page error, but the page background is transparent: CSS relative colour syntax is not supported. |
| 119–120          | Relative colours parse but read `l` on a 0–100 scale, so every derived surface colour is wrong.                |
| 121, 122, 156    | Identical page and surface colours. This is the floor.                                                         |

The relative colours are WE's design tokens (`packages/design-system/1-tokens/src/role.ts`, e.g.
`oklch(from var(--we-role-chrome) calc(l + 0.03) c h)`). Nothing in WE's script needs more than
113: `structuredClone` (98) is the newest unguarded API on the boot path; newer ones (`toSorted`,
`Object.hasOwn`, `RegExp.escape`, `AbortSignal.any`) are guarded or off it.

`pnpm check:floor` keeps the script half of this true: it asks esbuild to lower every script in
`www/` to `chrome121` and fails if anything changes, and does the same for the error page at
`chrome83`, the oldest WebView the app installs on (Android 11). The CSS half is not checked
mechanically: a token that needs a newer CSS feature means moving the floor and re-measuring.

Android System WebView updates through the Play Store, separately from Android, so the floor is a
WebView version, not an Android version. `minSdk` stays 30.

## What is left for phase 2

Phase 2a is the plugin, the join and the key login above, with no screens. Phase 2b, designed in
[`docs/phase-2b.md`](docs/phase-2b.md) and not built: the linking screens and the camera, choosing
the host, the master key (biometric-gated) and taking it, the device inbox, the Devices page, and
revoke and pause.

## Files

| Path                                                                  | What it is                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `capacitor.config.ts`                                                 | App id and name, `server.errorPath`, `android.minWebViewVersion`                                              |
| `src/webViewFloor.ts`                                                 | The floor, the error page's path, and which of its two messages a phone sees                                  |
| `src/error/`                                                          | The error page: plain DOM, built for WebView 83                                                               |
| `scripts/assemble-web.mjs`                                            | Builds `www/` from `apps/we-web/dist` and the error page                                                      |
| `scripts/check-floor.mjs`                                             | The script half of the floor, checked                                                                         |
| `scripts/cdp-eval.mjs`                                                | Evaluates an expression in the app's WebView over DevTools                                                    |
| `tests/webViewFloor.test.ts`                                          | The floor, the messages, and that the Capacitor config uses both                                              |
| `scripts/build-android-rust.sh`                                       | `crates/phone-custody` for arm64-v8a and x86_64, its Kotlin bindings, and the host library the JVM tests load |
| `android/app/src/main/java/org/coasys/app/devicekey/`                 | The `DeviceKey` plugin: the Keystore key, the AES-GCM sealer, the store's HTTP                                |
| `android/app/src/test/…/DeviceKeysJvmTest.kt`                         | The plugin's Kotlin over the real Rust library, on the JVM                                                    |
| `android/app/src/androidTest/…/KeystoreSealerTest.kt`                 | The Keystore half, on a device or emulator                                                                    |
| `../../crates/phone-custody/`                                         | The keys, the claim and the session statements, in Rust                                                       |
| `../we-web/src/platform/deviceKey*.ts`, `keySession.ts`, `keyHost.ts` | The plugin's TS surface, key login and renewal, the key host                                                  |
| `docs/phase-2b.md`                                                    | The design of phase 2b                                                                                        |
| `SPIKE.md`                                                            | The phone spike's record: the pinned Rust transport, since removed                                            |
