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

The session is kept: a closed and reopened app is still signed in.

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
cd android && ./gradlew assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Gradle needs JDK 21 and an Android
SDK (`JAVA_HOME`, `ANDROID_HOME`). No NDK and no Rust are needed.

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

## What phase 2 adds

Phase 1 signs in the way the web app does: email and password on a multi-user executor, which
holds the agent. Phase 2 gives the phone its own device key and signs in with it, as the desktop
apps do through their custody service (`crates/custody`, `ExecutorAddress` / `ViaExecutor`):

1. **A custody plugin surface.** A Capacitor plugin the web app calls for what the desktop's identity
   window does: hold the phone's device key, sign with it, and run the identity steps below. What
   the plugin is made of — a platform keystore key, or the custody crate built for Android and iOS —
   is the open device-key decision, and it changes this item most: which algorithms the key can use,
   whether it can ever leave the phone, and whether the Rust and NDK build comes back.
2. **Key login.** ad4m-connect signs in with the device key instead of a password: the executor
   checks the key against the identity's key log. This replaces the email and password screen.
3. **Link by scan.** The phone shows its device code (`show-code`), and a computer with the master key
   scans it (`scan-device`), compares the match code and signs the `add`. That needs the camera,
   which phase 1 removed with the spike's barcode scanner. If the device key cannot be exported, a
   link is the only way the phone gets an identity.
4. **Take the master key** (`take-master`, `ask-master`), only if the decision lets the phone keep one.
   A key the platform will not export cannot be sent anywhere, so a phone that holds the master key
   could never pass it on.
5. **Devices.** The Devices page from `publicState`: the private record's names and kinds,
   `holdsMaster`, and other devices' requests to answer.
6. **Revoke and pause.** Revoke is `revoke` (with "Also replace my master key"). Pause has no step in
   `crates/custody` yet and needs one.

None of these exist in phase 1, and nothing here pre-empts the decision: there is no key code, no
plugin and no native module.

## Files

| Path                         | What it is                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `capacitor.config.ts`        | App id and name, `server.errorPath`, `android.minWebViewVersion`             |
| `src/webViewFloor.ts`        | The floor, the error page's path, and which of its two messages a phone sees |
| `src/error/`                 | The error page: plain DOM, built for WebView 83                              |
| `scripts/assemble-web.mjs`   | Builds `www/` from `apps/we-web/dist` and the error page                     |
| `scripts/check-floor.mjs`    | The script half of the floor, checked                                        |
| `scripts/cdp-eval.mjs`       | Evaluates an expression in the app's WebView over DevTools                   |
| `tests/webViewFloor.test.ts` | The floor, the messages, and that the Capacitor config uses both             |
| `SPIKE.md`                   | The phone spike's record: the pinned Rust transport, since removed           |
