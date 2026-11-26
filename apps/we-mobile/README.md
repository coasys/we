# Coasys phone app (`apps/we-mobile`)

WE on a phone: `org.coasys.app`, shown as "Coasys". A Capacitor 8 shell around the Coasys app's web
build (`apps/coasys/dist`), copied unchanged. It runs in the platform WebView and reaches its
executor with the WebView's own `WebSocket` and `fetch`, the same way it does in a browser. Nothing
is replaced or patched in.

The Coasys app boots before any session (`apps/coasys/README.md`). On the phone it finds the
`DeviceKey` plugin and uses the phone's host: the first run asks how the phone comes in (make an
identity here, link to one, or use the 12 words), and the connection choice offers the key host the phone was given (`we-phone/key-host`)
and AD4M Connect. With no network it shows the offline screen rather than a connect screen that
cannot answer. WE's app mounts in the same page once a connection is chosen.

The phone can make an identity of its own, restore one from its 12 words and replace its master key
with them, with no computer and no executor (below, "Make, restore and replace"). The first run's
three doors open them (`apps/coasys/src/hosts/phone.ts`), and Settings opens replacing the master
key ("Replace master key").

The app adds one page of its own: the page Capacitor opens when the phone's Android System WebView
is too old to run WE, or when WE's page fails to load (`src/error/`).

Android is built and checked in CI (`.github/workflows/phone-app.yaml`). The iOS project is in the
tree, and `cap sync ios` works, but nothing builds it.

## How the phone connects

Through ad4m-connect, as the web app does (`apps/we-web/src/platform/ad4mConnector.ts`), once
"A host" is chosen on the connection choice. On a
phone-sized screen it offers only **Remote Node**: pick a listed host or type a URL, then sign in or
register with email and password on that executor (a multi-user executor: a host or Coasys cloud).
The executor must be reachable over `https`/`wss` with a certificate the phone trusts. The release
build allows no cleartext (`android/app/src/main/res/xml/network_security_config.xml`).

The session is kept: a closed and reopened app is still signed in. The executor token lives in the
WebView's storage, like the web app's: Android's app sandbox protects it, nothing seals it further,
and the app opts out of backup and device transfer so it does not leave the phone.

## The device key and key login

The phone has a key of its own, held by the `DeviceKey` plugin
(`android/app/src/main/java/org/coasys/app/devicekey/`) over `crates/phone-custody`, a Rust crate
built for Android with uniffi bindings:

- **The keys.** An Ed25519 device key (signing) and an X25519 key (for what is sent to the phone
  sealed), each a 32-byte seed. The seeds are made in software, in Rust, from the OS's random
  source, and are never kept in secure hardware: what the Keystore holds is the key that seals
  them, a non-exportable AES-256-GCM key (`KeystoreKey.kt`; no user authentication on the Keystore key itself, so unsealing
  needs no unlock; each signing is still confirmed by the person in a prompt of its own, below). StrongBox is preferred: the app asks for the key there first. Where the phone has no
  StrongBox it takes whatever level `AndroidKeyStore` gives instead: the TEE on a phone with a
  hardware Keystore, software on an emulator or a phone without one. Every level is accepted, and
  the one the key actually has is reported: `protection` in `status()` and `create()` (`strongbox`,
  `tee`, `software` or `unknown`), and WE logs it at each key login, as a warning when it is not
  `strongbox` or `tee`. The join screen also says so to the person when it is `software` or
  `unknown` ("This phone keeps your sign-in key without hardware protection"). The sealed seeds are
  in `no_backup/device-keys/device-keys.json`, which no backup or transfer includes. Only public
  keys and signatures cross into JS. The bridge is `status`, `create`, `join`, `waitJoined` and
  `signSession`. `signSession` signs a login or renewal statement, and each call raises a prompt
  that shows the whole canonical address it signs for ("Sign in to https://host.example"; never
  cut, and a destination that cannot be shown in full is refused), which the person
  answers with a fingerprint, a face or the screen lock. The statement's shape and domain
  separation are the native side's. A script in the app's origin can ask for a signature, but it
  cannot get one the person does not see and allow. See "Who may call the plugin" below.
- **Joining an identity.** `join({link})` claims an offer a computer holding the identity's master
  key opened (`https://coasys.id/o#coasys:offer:1:…`); both sides show the same match code, the
  computer signs an `add` listing the phone's keys, and `waitJoined()` sees it land.
- **Key login.** Once the phone has joined and has an executor to log in to, the connection choice
  offers it, and WE logs in there with the device key (`user.sessionChallenge` → a signed statement →
  `user.loginWithKey`), with no AD4M Connect involved, and renews the session five minutes before
  each expiry (`apps/we-web/src/platform/deviceKeyConnector.ts`, `keySession.ts`). The token is
  never stored, and AD4M Connect's stored session is left as it was: every boot logs in afresh. A key
  login the executor refuses (the key not known there, or revoked) goes back to the connection
  choice with the reason, where AD4M Connect is still offered; it never opens by itself. A session
  that ends by itself (no renewal succeeded before it expired, or the executor refused the token)
  starts WE again: the boot logs in afresh, or comes back to the connection choice when it cannot; a
  session that ended within a minute of opening skips the key login on the next boot, so it cannot
  loop. A phone with no key host connects as above.

### Known limits of the device key

- **For the device key, protection is reported, not required.** A device key sealed at `software`
  protection is used like any other (an emulator has no secure hardware). The person is told on
  the join screen, and the `protection` field and the warning WE logs say so too. The master key is held to more (below): it is not kept at `software` unless the
  person agrees.
- **What is wiped, and what is not.** Rust holds every seed it opens or makes in `Zeroizing`
  buffers, zeroed when the signature is made; the Kotlin sealer zeroes the plaintext `seal` was
  given once it is encrypted, and every plaintext `open` returned when Rust calls `wipe`. Not
  wiped: the copies UniFFI (0.32) makes on the way across the FFI. `seal` takes and `open` returns
  a plain `Vec<u8>`, serialised through a `RustBuffer` and the JVM's own buffers on each side with
  no zeroing, so a seed's plaintext can stay in freed native and JVM memory until it is reused.
  Follow-up: a zeroizing transfer path for secret bytes across the FFI.

The device key once had no screens of its own (the identity page, below, is how a person does it
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

## The identity on the phone

The phone runs its identity itself, through the identity store, with no computer in the loop: it
makes, restores or joins an identity, keeps the master key, replaces it with the words, adds
devices and answers their requests.

Why through the store and not through the executor the phone signs in to: that executor has its own
device key, in the same identity or another. Its operator-only identity calls (`claimOffer`,
`prepareDevice`, `inbox`, `takeMaster`, `unwrapRecordKey`, `rekey` and the like) act for _that_
key: they read its inbox, open with its enc key and sign with its key. A phone's session is
neither the operator nor local, and the calls would act for the wrong key anyway. So whatever the
phone's own key must sign or open, the phone does against the store directly, with a request signed
in `crates/phone-custody`. What is already signed (events, a signed offer, a master-signed
request) could go either way, and goes direct, so one path works whichever host the phone is signed
in to and a host in another identity is never asked to carry this identity's traffic. The sealed
record key is unwrapped in Rust with the phone's own enc seed, and never sent to JS or to the host.

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
  with what the key is about to do ("Confirm it's you to link a device"). The device key's sealer is
  unchanged, so a key login never prompts. The master key is kept only at `strongbox` or `tee`. At
  `software` (an emulator) the phone asks first ("Keep master key without a secure chip?"),
  and keeps it only if the person agrees. The vault keeps the rules of WE's desktop vault
  (`crates/custody`): each change is decided and written under one lock, the kept key never goes
  back a generation, a forget is a compare-and-delete on the index or on the **custody epoch**,
  and the epoch (a counter, never a digest) moves with every store, promote and forget, in the
  same atomic write of `master-keys.json`. The record's high-water mark is kept there too, so a
  store cannot serve the phone an older device list after a restart; a record that cannot be read
  is an error in Settings, never a list of unnamed devices.
- **The identity page.** `/mobile/identity.html` (`src/identity/`) is the shared identity window
  (`@we/identity-window`, the same screens the desktop opens) over the `DeviceKey` plugin. It is a
  page of its own, so no template, module or store code runs beside it. It wears the Coasys app's
  theme, name and mark, worked into static CSS when `www/` is built. WE opens it in two cases:
  - from the first run of a phone with no identity: to join one (`?join=`; "Not now" falls back to
    WE's own sign-in), to make one (`?change={"kind":"create"}`) or to restore one
    (`?change={"kind":"restore"}`);
  - for each change Settings asks for (`?change=<json>`), through the phone's custody host
    (`apps/we-web/src/platform/phoneCustody.ts`).

  It goes back (`?back=`) when the change ends. The join screen asks for the offer link and for the
  executor the phone signs in to (`we-phone/key-host`). The page is held to WE's WebView floor, not
  the error page's: only WE opens it.

- **What the phone can do.**
  - Join by an offer link, scanned or pasted.
  - Ask for the master key, and take it when it is sent (Settings shows "Master key sent to this
    phone" from the store inbox, `masterWaiting`).
  - As the holder: add a device by the `coasys:device:1:` code it shows (the camera reads it, a
    ticket goes to its pre-join inbox, the match code is checked, then the add). A phone never needs
    to show its own device code to a computer; it shows one only to be added by another phone.
  - Send the master key to a device that asked, and answer a revoke request.
  - Rename and revoke devices.

  Devices in Settings shows which devices hold the master key. The phone's own key is "This
  phone": the custody host names it (`thisDevice` in its state), since the device list comes from
  the executor the phone signs in to, which marks its own computer's key. That computer is listed by
  its name and kind like any other device.

  The record says what each device is, but the device that adds the phone cannot know: ad4m's claim
  carries a name hint and whether the device may keep the master key, not its kind, so a computer
  that adds the phone through a link writes it as a server. The phone writes its own entry as a
  `phone-app` (no place, no executor) the first time it reads its devices
  (`PhoneIdentity::devices`), only over the version it read, so a change another device made since
  is never overwritten.

- **Make, restore and replace.** `crates/phone-custody/src/steps.rs` runs the three 12-word flows
  over the store with no executor. The steps are `crates/identity-steps`, the crate the desktop's
  custody service runs too, so both decide and say the same things. Each flow is a step machine on
  a thread of its own. The page drives it through the plugin (`startMake`, `startRestore`,
  `startRotate`, then `identityStep({flow, input})`): each input is answered by one screen (the
  screens and inputs are listed in `IdentityStepsJson.kt`).
  - **Make:** the 12 new words are shown once, then the person writes them down. Two words are
    asked back, the phone is named, and master #0 is kept here behind one fingerprint. Then the
    incept, co-signed by the phone's device key, is published.
  - **Restore:** the 12 words are typed and the identity's devices are listed, with its apps ticked
    to lock out. One rotation revokes the ticked devices and keeps the new master key here, and
    the phone joins as a device. The revoke is always from now: the phone has no "missing since"
    input. If the store refuses the revoke after the rotation is published, the page shows
    "Devices not revoked yet" (`rotated-not-revoked`). Try again publishes only the revoke, with
    no words typed again, and then joins the phone.
  - **Replace:** the 12 words are typed and the next master key is kept here. The other devices
    that keep the master key are sent it.

  The master key is kept under the same rule as a taken one. A weak keystore gets the same
  question before any word is made or typed.

  The words exist only in Rust memory, in types that zero their bytes. They go to the page once,
  to be written down, and are wiped once two are typed back right or when the flow ends any other
  way (cancelled, an error, idle for 30 minutes). Typed words are wiped when the step that read
  them is done. The page shows words with the window marked secure (`setSecure({on})`: no
  screenshots, no recent-apps thumbnail), and nothing touches the clipboard.

  A make that kept its identity and could not publish it leaves it pending. The make's stop screen
  says so, and its Try again publishes it. Once the flow is gone, `finishPending()` publishes it:
  the phone's custody host calls it whenever it reads the identity and finds none but a pending one
  (`pendingIdentity()`), which is at every boot and every time Settings reads the identity, and
  the first run's alert says so until it is published. A new make does that too before it makes
  anything.

  **The screens** (`src/identity/transport.ts`, drawn by the shared window, so a phone and a
  computer read the same words, with "phone" where a computer's say "computer"):

  | Flow    | Screens                                                                                                          |
  | ------- | ---------------------------------------------------------------------------------------------------------------- |
  | Make    | `show-words` → `confirm-words` (again, with the error, while wrong) → `name-device` → `identity-ready`           |
  | Restore | `enter-words` (again, naming the wrong word's place) → `restore-devices` (tick devices to lock out) → `restored` |
  | Replace | `enter-words` → `master-replaced`                                                                                |

  The stops, each with Try again: `make-stopped` (pending: publish again; otherwise make again from
  the same words), `rotated-not-revoked`, `restore-not-linked` and `master-not-kept`. A flow that cannot start (no
  biometric, the person declined a weak keystore, a phone already in an identity, the store down) is
  a `failed` screen in the page's words.

  The DID is shown on `identity-ready` only, where it is made; no other new screen draws one
  (`packages/identity-window/src/screens.test.ts` checks the window's source for it).

  The window is secure from before the flow starts (so before the plugin makes a word) until the
  first screen that neither shows nor asks for the words, and is cleared when the page leaves
  (Done, Close or Cancel), which also cancels a flow still open. If it cannot be made secure, the
  page shows no words and asks for none (`NOT_SECURE`). The transport keeps only the last screen's
  name, never a screen, and the window clears its word fields when another screen is drawn.

  A new log's first event carries a proof of work. The pinned store checks one only when it is
  sent, but the phone always sends one so it keeps working once the store requires it. It solves it
  (`src/brake.rs`, ad4m's solver) at the bits the store names (`GET /v1/pow`), and refuses more
  than 28 bits. At the store's default of 22 bits, a solve in a release build on a desktop CPU took
  143 ms to 2.3 s (median about 0.5 s); the whole make against the store binary, 0.05 to 3.5 s. The
  spread is the search's own: some solves take several times the median. An unoptimised (debug)
  build is far slower, about 39 s once, so time it only in release. A phone is slower.

- **What it cannot.** A revoke that rotates in the same step (revoking a device that keeps the
  master key, and replacing the master key with it): the phone revokes the device and the person
  then chooses "Replace master key". A revoke request that asks for a rotation is answered on
  a computer. Removing the master key from the phone and adding a bot are a computer's too.
- **Who may call the plugin.** WE runs installed modules and cartridges in the same origin as its
  own pages, so "a call from this app" says nothing about who made it. The plugin binds the
  principal to the **document**, not to an address: `CallerDocument.kt` records which document is
  loaded, from real page loads only (`bridge.addWebViewListener` → `onPageStarted`, which Android
  raises for a navigation that creates a document and not for `history.pushState`, `replaceState`
  or a fragment change), and each real load bumps a generation counter. The WebView's current
  address (`WebView.url`) is never read for the gate, because a script on any page of the origin
  can rewrite it with `pushState` without loading the identity page. `CallerPage.kt` only parses
  the loaded document's address. From `onPageStarted` until the matching `onPageLoaded` the new
  document is _loading_ and admits no identity-page call, because a page that sets `location`
  keeps running and posting until it unloads; the call is admitted on the bridge's thread before
  any wait. Only main-frame calls reach a plugin: Capacitor's `MessageHandler` registers
  `androidBridge` with `WebViewCompat.addWebMessageListener` and drops a message whose `isMainFrame`
  is false, so an iframe loading `identity.html` cannot call (the plugin refuses outright under
  `useLegacyBridge`, whose `addJavascriptInterface` reaches every frame). A call that waits (a prompt, the camera, the network) holds a
  ticket with the generation it was admitted under and is refused with `NotAllowed` if any load
  happened before it mutates or signs, so what a script cannot fake is the rule:
  - Everything that links a device, sends the master key, renames, revokes, answers a request,
    joins, takes or asks for the master key, makes or restores an identity, replaces the master key
    (or touches the 12 words in any way), finishes a pending publish, or opens the camera is accepted **only from the
    identity page** (`/mobile/identity.html`, `IDENTITY_PAGE` in `phoneCustody.ts`); any other page
    is refused with `NotAllowed`. That page runs no template, module or store code.
  - Reads of public state (`status`, `identityStatus`, `devices`, `requests`, `masterWaiting`) and
    `signSession` are open to the app's other pages, because Settings and the key login at boot
    run there. `signSession` is the one signing call that is, and it is confirmed by the person each
    time (title and description: the full address). Because the prompt is shown for every signing, a session renewal asks
    too.
  - `scanDevice()` takes no code: the camera reads it inside the plugin, and the page learns only
    that a link is running. A pasted code cannot add a device.
  - The match code is compared natively. The person types the code the other device shows into a
    dialog of the app's own, and `MatchCode.kt` compares it with the one the plugin derived from the
    claim. A mismatch ends the link; the page cannot say that they matched.
  - Sending the master key (`keepMaster`) asks for a strong biometric of its own, separate from the
    unlock that opened the master key, and names the device ("Send your master key to Work
    laptop"). `rename` asks too ("Rename Phone to Office").
  - The document is checked when the call arrives and again after every prompt, scan or link step
    that precedes a change. Not yet confirmed on a device: that `onPageStarted` stays silent for
    `pushState` on a real WebView (below the Capacitor source, it is Android's documented
    `WebViewClient` behaviour). WebView debugging stays off unless a build asks for
    it (below), since a call from DevTools would come from the page it is on.
- **The camera.** `ScanActivity.kt`: CameraX and ML Kit's bundled barcode scanner (the model ships
  in the app; no Play services, nothing sent anywhere). A QR that is not the expected kind is passed
  over. A refused camera permission comes back as `denied`, and the page offers pasting.
- **Offline.** A key login that cannot reach the executor tries again for a minute, then shows the
  boot screen's could-not-reach with Try again, never the password screen. Settings on a phone that
  cannot reach its store says so and offers no changes. A revoked phone offers none either.

`crates/custody/tests/live.rs`'s `a_phone_keeps_the_master_key_and_answers_for_it` is the computers'
side of the emulator run for the identity on the phone. It starts a throwaway store and executor A (with this computer's
custody service as "Desktop A") and makes an identity, then steps with the phone through files in
`CUSTODY_PHONE_MASTER_DIR`:

1. the phone joins by paste;
2. it asks for the master key, which A sends, and takes it behind the fingerprint;
3. it adds desktop B by B's code;
4. it sends B the master key B asked for, and B takes it.

```sh
cd crates/custody
CUSTODY_LIVE=1 CUSTODY_PHONE_MASTER_DIR=<empty dir> AD4M_REPO=<ad4m> \
  AD4M_EXECUTOR=<copy of ad4m-executor> IDENTITY_STORE_BIN=<copy of identity-store> \
  cargo test --features cheap-kdf --test live a_phone_keeps_the_master_key_and_answers_for_it -- --nocapture
```

Build `ad4m-executor` (`--release`) and `identity-store` in the ad4m checkout at the commit WE pins,
then copy both somewhere of their own and name the copies. Without them the test runs
`<ad4m>/target/release/ad4m-executor`. When several ad4m checkouts share one target folder, another
checkout's build may have replaced it, and executor A then lacks the calls the test needs: the phone's
request is never listed, and the test waits.

On the phone's side:

1. Build the APK with the store and keys from `store.json` in the environment.
2. Set a PIN and enrol a fingerprint (`adb -e emu finger touch 1` at each prompt).
3. `adb reverse` the store's port and A's port, install, and `touch <dir>/ready`.
4. Write `taken` and `done` when the table in the test's doc says.

## Build

From the repo root:

```sh
pnpm install
pnpm build:coasys              # the Coasys app's web build: apps/coasys/dist
cd apps/we-mobile
pnpm build:web                 # www/ = apps/coasys/dist + the error and identity pages in www/mobile/
pnpm check:floor               # WE's scripts parse on the WebView floor; the error page parses on WebView 83
pnpm test                      # the floor and the error page's wording
pnpm exec cap sync android     # www/ and capacitor.config into android/
scripts/build-android-rust.sh  # crates/phone-custody for the phone, and its Kotlin bindings
cd android && ./gradlew :app:testDebugUnitTest assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Every debug build, CI's included, is
signed with the checked-in `android/app/debug.keystore`, so a new APK installs over an older one and
keeps its data.

**A debug APK must never reach a real person.** Its key is in the repository, so anyone can sign an
update with it, and Android hands an update the app's data and user ID: that update could unseal the
device key in `no_backup/device-keys`. Debug builds are for test phones and emulators only.

A build for people is `./gradlew assembleRelease` (or `bundleRelease`), signed with a key kept
outside the repo. The `release` signing config reads it from the environment or from Gradle
properties (`~/.gradle/gradle.properties` or `-P`):

| Setting                     | What                            |
| --------------------------- | ------------------------------- |
| `WE_RELEASE_STORE_FILE`     | Path to the keystore file       |
| `WE_RELEASE_STORE_PASSWORD` | The keystore's password         |
| `WE_RELEASE_KEY_ALIAS`      | The key's alias in the keystore |
| `WE_RELEASE_KEY_PASSWORD`   | The key's password              |

A release build with any of them missing fails before it builds, and never falls back to the debug
key. Keep the release keystore and its passwords out of the repo and out of CI logs.

Gradle needs JDK 21 and an Android
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

To read or drive the WebView without tapping, sync with WebView debugging on, then build and install
as above. It is off unless asked for, in debug builds too, since it lets anyone with the phone over
USB call the identity plugin from the page:

```sh
WE_MOBILE_INSPECTABLE=1 pnpm exec cap sync android
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

A step up the surface stack also bounds its chroma, so a near-white surface stays inside sRGB.
WebView 124 paints an out-of-gamut colour on the page's root background without clipping it: a
page of `oklch(1 0.0023 288)` (the light theme's, before the bound) came out pure yellow, its blue
channel past 255 and wrapped. The same colour on any other element, and in desktop Chrome, is
clipped to white. `stepUp` in `role.ts` is the bound.

`pnpm check:floor` keeps the script half of this true: it asks esbuild to lower every script in
`www/` to `chrome121` and fails if anything changes, and does the same for the error page at
`chrome83`, the oldest WebView the app installs on (Android 11). The CSS half is not checked
mechanically: a token that needs a newer CSS feature means moving the floor and re-measuring.

Android System WebView updates through the Play Store, separately from Android, so the floor is a
WebView version, not an Android version. `minSdk` stays 30.

## What is left on the phone

- A revoke that rotates in one step, on the phone. It runs on a computer; the phone does the
  two one after the other.
- Retrying the pushes of a replaced master key to the other holders (`retryMasterPushes`) from
  the page: the plugin method and its TS binding exist, and no screen calls it yet.
- Pause, and choosing the host from a list.

## Files

| Path                                                                            | What it is                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `capacitor.config.ts`                                                           | App id and name, `server.errorPath`, `android.minWebViewVersion`                                              |
| `src/webViewFloor.ts`                                                           | The floor, the error page's path, and which of its two messages a phone sees                                  |
| `src/error/`                                                                    | The error page: plain DOM, built for WebView 83                                                               |
| `scripts/assemble-web.mjs`                                                      | Builds `www/` from `apps/coasys/dist`, the error page and the identity page                                   |
| `scripts/check-floor.mjs`                                                       | The script half of the floor, checked                                                                         |
| `scripts/cdp-eval.mjs`                                                          | Evaluates an expression in the app's WebView over DevTools                                                    |
| `tests/webViewFloor.test.ts`                                                    | The floor, the messages, and that the Capacitor config uses both                                              |
| `scripts/build-android-rust.sh`                                                 | `crates/phone-custody` for arm64-v8a and x86_64, its Kotlin bindings, and the host library the JVM tests load |
| `android/app/src/main/java/org/coasys/app/devicekey/`                           | The `DeviceKey` plugin: the Keystore key, the AES-GCM sealer, the store's HTTP                                |
| `…/devicekey/MasterKeystoreKey.kt`, `BiometricMasterSealer.kt`                  | The master key's Keystore key, and its sealer behind one biometric prompt per use                             |
| `…/devicekey/CallerPage.kt`, `MatchCode.kt`, `ActionPrompt.kt`, `PromptText.kt` | Which page may call, the native match-code compare, and the prompts that name each action                     |
| `…/devicekey/StoreHttp.kt`                                                      | The identity store's HTTP, to the client's `HttpClient` contract                                              |
| `…/devicekey/ScanActivity.kt`                                                   | The camera: CameraX and ML Kit's bundled barcode scanner                                                      |
| `…/devicekey/IdentityStepsJson.kt`                                              | The make, restore and replace flows' screens and inputs, as the page's JSON                                   |
| `src/identity/`                                                                 | The phone's identity page: the shared identity window over the plugin                                         |
| `tests/identityTransport.test.ts`                                               | The identity page's transport over a fake plugin                                                              |
| `android/app/src/test/…/DeviceKeysJvmTest.kt`                                   | The plugin's Kotlin over the real Rust library, on the JVM                                                    |
| `android/app/src/test/…/CallerGuardJvmTest.kt`                                  | The calling-page rule, the match-code compare and the prompt wording, on the JVM                              |
| `android/app/src/test/…/PhoneIdentityJvmTest.kt`, `ScanCodeJvmTest.kt`          | The identity flows over a real store's ports, and the scanner's code parsing, on the JVM                      |
| `android/app/src/test/…/IdentityStepsJvmTest.kt`                                | The make flow through the plugin's handle, and the steps' JSON, on the JVM                                    |
| `android/app/src/androidTest/…/KeystoreSealerTest.kt`                           | The Keystore half, on a device or emulator                                                                    |
| `../../crates/phone-custody/`                                                   | The keys, the claim and the session statements, in Rust                                                       |
| `../../crates/phone-custody/src/{ports,identity,vault,holder,checkpoint}.rs`    | The store over the phone's ports, the identity flows, the master key's vault, adding a device, checkpoints    |
| `../../crates/phone-custody/src/{steps,brake}.rs`                               | Make, restore and replace with the words; the proof of work a new log's first event carries                   |
| `../../crates/identity-steps/`                                                  | The steps of make, restore and replace, and the publish driver, shared with the desktop's `crates/custody`    |
| `../we-web/src/platform/deviceKey*.ts`, `keySession.ts`, `keyHost.ts`           | The plugin's TS surface, key login and renewal, the key host                                                  |
| `../we-web/src/platform/phoneCustody.ts`                                        | Settings' custody host on the phone: the plugin's reads, changes sent to the identity page                    |
