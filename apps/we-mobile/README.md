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
  sealed), each a 32-byte seed. The seeds are made in software, in Rust, from the OS's random
  source, and are never kept in secure hardware: what the Keystore holds is the key that seals
  them, a non-exportable AES-256-GCM key (`KeystoreKey.kt`; no user authentication, so a login asks
  nothing). StrongBox is preferred: the app asks for the key there first. Where the phone has no
  StrongBox it takes whatever level `AndroidKeyStore` gives instead: the TEE on a phone with a
  hardware Keystore, software on an emulator or a phone without one. Every level is accepted, and
  the one the key actually has is reported: `protection` in `status()` and `create()` (`strongbox`,
  `tee`, `software` or `unknown`), and WE logs it at each key login, as a warning when it is not
  `strongbox` or `tee`. The sealed seeds are in `no_backup/device-keys/device-keys.json`, which no
  backup or transfer includes. Only public keys and signatures cross into JS. The bridge is `status`, `create`, `join`, `waitJoined` and
  `signSession`, and `signSession` signs a login or renewal statement for whatever executor and
  URL the page names, with no prompt: the statement's shape and domain separation are the native
  side's, but which executor to log in to is the page's choice. So every script that runs in the
  app's origin, the error page included, is trusted with the phone's login; a page the app loads
  from elsewhere is not in that origin.
- **Joining an identity.** `join({link})` claims an offer a computer holding the identity's master
  key opened (`https://id.coasys.org/o#coasys:offer:1:…`); both sides show the same match code, the
  computer signs an `add` listing the phone's keys, and `waitJoined()` sees it land.
- **Key login.** Once the phone has joined and has an executor to log in to, WE logs in with the
  device key (`user.sessionChallenge` → a signed statement → `user.loginWithKey`) instead of showing
  the connect screen, and renews the session five minutes before each expiry
  (`apps/we-web/src/platform/deviceKeyConnector.ts`, `keySession.ts`). The token is never stored:
  every boot logs in afresh, and a key login removes the password session the connect screen may
  have stored before it, so a later fall-back never sends one host's token to another. A session
  that ends by itself (no renewal succeeded before it expired, or the executor refused the token)
  starts WE again: the boot logs in afresh, or shows the connect screen when it cannot; a session
  that ended within a minute of opening skips the key login on the next boot, so it cannot loop.
  Anywhere else, and on a phone that has not joined, WE connects as in phase 1.

### Known limits of phase 2a

- **For the device key, protection is reported, not required.** A device key sealed at `software`
  protection is used like any other. The only signs are the `protection` field and the warning WE
  logs. The master key is held to more (phase 2b, below): it is not kept at `software` unless the
  person agrees.
- **What is wiped, and what is not.** Rust holds every seed it opens or makes in `Zeroizing`
  buffers, zeroed when the signature is made; the Kotlin sealer zeroes the plaintext `seal` was
  given once it is encrypted, and every plaintext `open` returned when Rust calls `wipe`. Not
  wiped: the copies UniFFI (0.32) makes on the way across the FFI. `seal` takes and `open` returns
  a plain `Vec<u8>`, serialised through a `RustBuffer` and the JVM's own buffers on each side with
  no zeroing, so a seed's plaintext can stay in freed native and JVM memory until it is reused.
  Follow-up: a zeroizing transfer path for secret bytes across the FFI.
- **A renewed token does not reach the open client.** Renewal updates the token ad4m-connect and
  an embedded app read, but the `Ad4mClient` WE's ports hold keeps the one it was built with, so a
  socket that reconnects after the first token expired is refused (and WE starts again, above).
  The pinned ad4m has no way to hand a client a new token; `Ad4mClient.setToken` is the fix, and
  `handRenewedToken` in `deviceKeyConnector.ts` calls it once WE pins an ad4m that has it.

Phase 2a had no screens for any of this (phase 2b's identity page, below, is how a person does it
now). The executor to log in to is the localStorage key `we-phone/key-host` (an http(s) URL); the
plugin's calls can still be driven from DevTools:

```sh
node scripts/cdp-eval.mjs "JSON.stringify(await Capacitor.Plugins.DeviceKey.create())"
node scripts/cdp-eval.mjs "JSON.stringify(await Capacitor.Plugins.DeviceKey.join({link: '<offer link>', hint: 'My phone'}))"
node scripts/cdp-eval.mjs "JSON.stringify(await Capacitor.Plugins.DeviceKey.waitJoined({seconds: 120}))"
node scripts/cdp-eval.mjs "(localStorage.setItem('we-phone/key-host', 'http://127.0.0.1:<port>'), location.reload())"
```

`crates/custody/tests/live.rs`'s `a_phone_joins_through_an_offer` is the computer's side of that
run, against a throwaway store and executor.

## The identity on the phone (phase 2b)

Designed in [`docs/phase-2b.md`](docs/phase-2b.md). The phone runs its identity itself, through the
identity store, with no computer in the loop: it joins, keeps the master key, adds devices and
answers their requests.

- **Through the store.** `crates/phone-custody` runs `ad4m-identity-client`'s flows over a
  `ViaStore` built from the phone's own ports (`src/ports.rs`): the store's HTTP is the app's
  (`StoreHttp.kt`, a blocking foreign trait), and the device and enc keys sign and open over the
  sealed seeds. `StoreHttp.kt` holds to the client's `HttpClient` contract: https only (http to the
  phone's loopback in a debug build), no redirects, a size cap on every answer, connect, read and
  whole-call timeouts, and nothing logged. A phone that has not joined speaks to the deployment's
  store, which the build names: `AD4M_IDENTITY_STORE_URL` and `AD4M_IDENTITY_STORE_KEYS`
  (comma-separated) in the environment of the Gradle build become `BuildConfig` fields. Without
  keys, every call that commits to the log refuses (`no-store-keys`). A joined phone speaks to the
  store it joined at.
- **Log checkpoints.** The head each identity's log was last admitted at is kept in
  `no_backup/device-keys/log-checkpoints.json` (`src/checkpoint.rs`), so a store cannot serve the
  phone an older log at the next call or after a restart. It fails closed: a file that cannot be
  read or parsed fails the read (`503`) rather than counting as "no checkpoint".
- **The master key, behind the biometric.** `PhoneVault` (`src/vault.rs`) keeps the master seed in
  `master-keys.json`, sealed by a second Keystore key (`MasterKeystoreKey.kt`) that needs a strong
  biometric for every use (auth timeout 0, invalidated by a new enrolment). Each seal and each open
  is one `BiometricPrompt` with the cipher as its `CryptoObject` (`BiometricMasterSealer.kt`), titled
  with what the key is about to do ("Add a device to your identity"). The device key's sealer is
  unchanged, so a key login never prompts. The master key is kept only at `strongbox` or `tee`. At
  `software` (an emulator) the phone asks first ("Keep your master key without secure hardware?"),
  and keeps it only if the person agrees.
- **The identity page.** `/mobile/identity.html` (`src/identity/`) is the shared identity window
  (`@we/identity-window`, the same screens the desktop opens) over the `DeviceKey` plugin. It is a
  page of its own, so no template, module or store code runs beside it. WE opens it in two cases:
  - on the first boot of a phone with no identity, to join one (`?join=`). "Not now" falls back to
    WE's own sign-in;
  - for each change Settings asks for (`?change=<json>`), through the phone's custody host
    (`apps/we-web/src/platform/phoneCustody.ts`).

  It goes back (`?back=`) when the change ends. The join screen asks for the offer link and for the
  executor the phone signs in to (`we-phone/key-host`). The page is held to WE's WebView floor, not
  the error page's: only WE opens it.

- **What the phone can do.**
  - Join by an offer link, scanned or pasted.
  - Ask for the master key, and take it when it is sent (Settings shows "Your master key was sent
    here" from the store inbox, `masterWaiting`).
  - As the holder: add a device by the `coasys:device:1:` code it shows (scan or paste, a ticket in
    its pre-join inbox, the match code, then the add).
  - Send the master key to a device that asked, and answer a revoke request.
  - Rename and revoke devices.

  Devices in Settings shows which devices hold the master key.

- **What it cannot.** Anything that needs the 12 words: replacing the master key, restoring, and a
  revoke that rotates. The phone takes no words (`takesWords: false`), and those requests are left
  for a computer.
- **The camera.** `ScanActivity.kt`: CameraX and ML Kit's bundled barcode scanner (the model ships
  in the app; no Play services, nothing sent anywhere). A QR that is not the expected kind is passed
  over. A refused camera permission comes back as `denied`, and the page offers pasting.
- **Offline.** A key login that cannot reach the executor tries again for a minute, then shows the
  boot screen's could-not-reach with Try again, never the password screen. Settings on a phone that
  cannot reach its store says so and offers no changes. A revoked phone offers none either.

`crates/custody/tests/live.rs`'s `a_phone_keeps_the_master_key_and_answers_for_it` is the computers'
side of the phase 2b emulator run. It starts a throwaway store and executor A (with this computer's
custody service as "Desktop A") and makes an identity, then steps with the phone through files in
`CUSTODY_PHONE_2B_DIR`:

1. the phone joins by paste;
2. it asks for the master key, which A sends, and takes it behind the fingerprint;
3. it adds desktop B by B's code;
4. it sends B the master key B asked for, and B takes it.

```sh
cd crates/custody
CUSTODY_LIVE=1 CUSTODY_PHONE_2B_DIR=<empty dir> AD4M_REPO=<ad4m> \
  cargo test --features cheap-kdf --test live a_phone_keeps_the_master_key_and_answers_for_it -- --nocapture
```

On the phone's side:

1. Build the APK with the store and keys from `store.json` in the environment.
2. Set a PIN and enrol a fingerprint (`adb -e emu finger touch 1` at each prompt).
3. `adb reverse` the store's port and A's port, install, and `touch <dir>/ready`.
4. Write `taken` and `done` when the table in the test's doc says.

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

- The 12-word changes on the phone: replacing the master key, restoring, a rotating revoke. They run
  on a computer.
- On the phone, Settings' Devices page calls the executor's own device (the one the phone signs in
  to) "This computer". The device list comes from that executor, and nothing marks the phone's own
  key there yet.
- Pause, and choosing the host from a list.

## Files

| Path                                                                         | What it is                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `capacitor.config.ts`                                                        | App id and name, `server.errorPath`, `android.minWebViewVersion`                                              |
| `src/webViewFloor.ts`                                                        | The floor, the error page's path, and which of its two messages a phone sees                                  |
| `src/error/`                                                                 | The error page: plain DOM, built for WebView 83                                                               |
| `scripts/assemble-web.mjs`                                                   | Builds `www/` from `apps/we-web/dist` and the error page                                                      |
| `scripts/check-floor.mjs`                                                    | The script half of the floor, checked                                                                         |
| `scripts/cdp-eval.mjs`                                                       | Evaluates an expression in the app's WebView over DevTools                                                    |
| `tests/webViewFloor.test.ts`                                                 | The floor, the messages, and that the Capacitor config uses both                                              |
| `scripts/build-android-rust.sh`                                              | `crates/phone-custody` for arm64-v8a and x86_64, its Kotlin bindings, and the host library the JVM tests load |
| `android/app/src/main/java/org/coasys/app/devicekey/`                        | The `DeviceKey` plugin: the Keystore key, the AES-GCM sealer, the store's HTTP                                |
| `…/devicekey/MasterKeystoreKey.kt`, `BiometricMasterSealer.kt`               | The master key's Keystore key, and its sealer behind one biometric prompt per use                             |
| `…/devicekey/StoreHttp.kt`                                                   | The identity store's HTTP, to the client's `HttpClient` contract                                              |
| `…/devicekey/ScanActivity.kt`                                                | The camera: CameraX and ML Kit's bundled barcode scanner                                                      |
| `src/identity/`                                                              | The phone's identity page: the shared identity window over the plugin                                         |
| `tests/identityTransport.test.ts`                                            | The identity page's transport over a fake plugin                                                              |
| `android/app/src/test/…/DeviceKeysJvmTest.kt`                                | The plugin's Kotlin over the real Rust library, on the JVM                                                    |
| `android/app/src/test/…/PhoneIdentityJvmTest.kt`, `ScanCodeJvmTest.kt`       | The identity flows over a real store's ports, and the scanner's code parsing, on the JVM                      |
| `android/app/src/androidTest/…/KeystoreSealerTest.kt`                        | The Keystore half, on a device or emulator                                                                    |
| `../../crates/phone-custody/`                                                | The keys, the claim and the session statements, in Rust                                                       |
| `../../crates/phone-custody/src/{ports,identity,vault,holder,checkpoint}.rs` | The store over the phone's ports, the identity flows, the master key's vault, adding a device, checkpoints    |
| `../we-web/src/platform/deviceKey*.ts`, `keySession.ts`, `keyHost.ts`        | The plugin's TS surface, key login and renewal, the key host                                                  |
| `../we-web/src/platform/phoneCustody.ts`                                     | Settings' custody host on the phone: the plugin's reads, changes sent to the identity page                    |
| `docs/phase-2b.md`                                                           | The design of phase 2b                                                                                        |
| `SPIKE.md`                                                                   | The phone spike's record: the pinned Rust transport, since removed                                            |
