# Phone spike 1: the pinned connection in a Capacitor shell

## Result

The pinned, Rust-backed connection works inside Capacitor 8 on Android. All five exit criteria pass
on the emulator. WE's real web build, unchanged except for one added script tag, boots on the phone
and authenticates against a desktop executor through the connection.

Nothing found argues for reopening the shell decision. Some findings set conditions for the next
spikes. See "What to decide next".

iOS is not verified. The Swift plugin and the XCFramework script exist, but nobody compiled them.

## What was built

| Part                          | Where                                    | What it does                                                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport crate               | `crates/phone-transport`                 | TLS 1.3 WebSocket client and one-shot HTTP request. `tokio`, `tokio-tungstenite`, `rustls` with `ring`. No OpenSSL. No platform verifier. Exported through uniffi.                                                                            |
| Pin rule                      | `src/verifier.rs`                        | Accepts the certificate only when SHA-256 of its SubjectPublicKeyInfo equals the pin and its SAN names the host dialled (an IP SAN for an IP). Checks the TLS 1.3 handshake signature with the certificate's key.                             |
| Desktop stand-in              | `src/bin/spike-endpoint.rs`              | Self-signed certificate for the machine's private IPs, `10.0.2.2`, `127.0.0.1` and `localhost`. TLS 1.3 listener. Copies each connection byte for byte to `--upstream`, or echoes (`--echo`). Prints the pin, the URL and a terminal QR code. |
| Capacitor app                 | `apps/we-phone`                          | `org.coasys.app`, "Coasys". `webDir` is `www`: WE's `apps/we-web/dist`, copied, plus the phone's own pages.                                                                                                                                   |
| Plugin `CoasysTransport`      | `apps/we-phone/plugins/coasys-transport` | Kotlin (verified) and Swift (not verified). `connect`, `send`, `close`, `request`, `reset`, `runtimeInfo`. Events `open`, `message`, `close`, `error`.                                                                                        |
| JS adapters                   | `plugins/coasys-transport/src`           | `PinnedWebSocket` (shaped like the DOM `WebSocket`), `installPinnedWebSocket` and `installPinnedFetch` (switch only the paired desktop's origin).                                                                                             |
| The switch in WE              | `apps/we-phone/src/boot.ts`              | A classic script that runs before WE's bundle. It installs the two adapters and writes the desktop URL (and token) where ad4m-connect reads them. No WE source file changed.                                                                  |
| Pairing and diagnostic screen | `apps/we-phone/src/diag`                 | Scan or paste the pairing, connect, send `agent.status`, show 200 round trips. Its functions are on `window.coasysDiag` for automated runs.                                                                                                   |
| QR scanning                   | `@capacitor/barcode-scanner` 3.1.3       | Installed cleanly and builds. Not exercised: the emulator has no camera feed. The paste field is the fallback.                                                                                                                                |
| Build scripts                 | `apps/we-phone/scripts`                  | `assemble-web.mjs`, `build-android-rust.sh`, `build-ios.sh` (not run), `cdp-eval.mjs` (drives the WebView over DevTools), `host-baseline.mjs`.                                                                                                |
| CI                            | `.github/workflows/phone-spike.yaml`     | Crate tests and clippy, the Android APK, the iOS XCFramework. Written, not run.                                                                                                                                                               |

Versions: Capacitor 8.6.0, uniffi 0.32.2, rustls 0.23.46 (`ring` 0.17.14), tokio-rustls 0.26.6,
tokio-tungstenite and tungstenite 0.30.0, rustls-webpki 0.103.16, rcgen 0.14.10, tokio 1.54.1,
JNA 5.17.0, Android Gradle Plugin 8.13.0, Gradle 8.14.3, Kotlin 2.2.20, NDK 27.2, minSdk 30.

## How to run it

On the desktop:

1. Build WE for the web: `pnpm build:web` at the repo root.
2. Start an executor to test against. Do not use your own. Use a throwaway one with a temporary
   data directory, as `packages/backend-system/ad4m/tests/live/executor.ts` does:
   `ad4m-executor init --data-path <tmp>`, then
   `ad4m-executor run --app-data-path <tmp> --port 12600 --admin-credential <token> --hc-use-bootstrap false --hc-use-proxy false --hc-use-local-proxy false --hc-use-mdns false --run-dapp-server false`.
   (`node scripts/ad4m-executor.mjs --path` names the pinned executor.)
3. Start the endpoint:
   `cd crates/phone-transport && cargo run --release --features endpoint --bin spike-endpoint -- --upstream ws://127.0.0.1:12600 --cert-dir ~/.local/share/coasys-spike-cert`.
   It prints the pin, the URL and the QR code. The key in `--cert-dir` is the pin. Keep it. If the
   machine's addresses change, delete only `cert.pem`: the endpoint issues a new certificate for the
   same key, and the pin stays the same.

Build and install the app:

```sh
source ~/.local/share/android-env.sh        # JAVA_HOME, ANDROID_HOME, ANDROID_NDK_HOME
cd apps/we-phone
pnpm build:web                              # assembles www/ from apps/we-web/dist
npx cap sync android
scripts/build-android-rust.sh               # .so files into jniLibs, Kotlin bindings into the plugin
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On the phone (or emulator): the app opens the pairing screen when it has no pairing. Scan the QR
code, or paste the `pairing:` line. On the emulator the desktop is `wss://10.0.2.2:<port>`. For WE
to sign in, give the executor token too (spike only: see "What to decide next"). Press "Save and
open WE".

To measure from the desktop without tapping, with a debug build running:

```sh
node scripts/cdp-eval.mjs "await coasysDiag.roundTrips({url:'wss://10.0.2.2:8443', pin:'<pin>', token:'<token>'}, 200)"
node scripts/host-baseline.mjs ws://127.0.0.1:12600 <token>
```

## Exit criteria

All results come from the emulator: AVD `coasys-api30` (Android 11, x86_64, WebView 83) unless the
text names `coasys-api35-webview` (Android 15, WebView 124). The upstream was a throwaway executor
on `127.0.0.1:12600` with its own data directory and an agent made for the test. Nothing was sent
to the machine's own executor.

### 1. A wrong pin is refused, and no application data leaves the phone: PASS

- The plugin reported `pin-mismatch` ("the certificate's key is not the one paired"), then
  `close 1006`.
- The endpoint logged `handshake refused: received fatal alert: AccessDenied`. It never logged a
  finished handshake or a byte proxied upstream.
- The host test `a_wrong_pin_is_refused_before_any_application_data` counts on the server side:
  0 handshakes completed, 0 WebSocket upgrades received. The client refuses inside the handshake,
  and the upgrade request is the first application byte, so nothing follows.
- The pinned HTTP request obeys the same rule (`a_pinned_http_request_to_a_wrong_pin_sends_nothing`).

### 2. The right certificate on another host is refused: PASS

A second endpoint served a certificate for the same key, naming only `192.168.77.77`. The phone
dialled it at `10.0.2.2` with the right pin. The plugin reported `host-mismatch` ("the paired
certificate does not name 10.0.2.2"). The endpoint logged `BadCertificate`. Host tests also cover
a DNS name the certificate does not name, and an IP SAN dialled by name.

### 3. Traffic over the bridge: PASS

200 sequential `agent.status` calls (read-only), each waiting for its reply. Three runs each.

| Path                                                                | p50            | p95          | max        | messages/s    |
| ------------------------------------------------------------------- | -------------- | ------------ | ---------- | ------------- |
| WebView → plugin → Rust → endpoint → executor, API 30               | 1.7–1.9 ms     | 2.4–3.2 ms   | 3.0–7.3 ms | 477–563       |
| The same, API 35                                                    | 1.7–1.8 ms     | 2.2–2.7 ms   | 4.9–9.2 ms | 524–553       |
| Rust alone on the emulator → endpoint → executor (`examples/probe`) | 0.38–0.47 ms   | 0.46–0.67 ms |            | 2000–2640     |
| Plain WebSocket on the host → executor (`host-baseline.mjs`)        | 0.025–0.032 ms | 0.08–0.10 ms | 0.8–1.6 ms | 17 700–25 200 |

So the Capacitor bridge adds about 1.3 ms to each round trip on the emulator: one call into native
code for `send`, and one event back. Rust, TLS and the proxy add about 0.4 ms, most of it the
emulator's network.

Connecting took 506 ms on the emulator, every time. This is the emulator, not the connection: its
user-mode network holds the first segment a guest sends on a new TCP connection until 500 ms after
the connection starts. `examples/probe` shows it. After a 600 ms pause, the handshake took 2.8 ms.
On the host it takes 0.2–0.4 ms. `openssl s_server` behind the same probe also shows 500 ms, so it
is not the endpoint. Measure connect time again on a physical phone.

### 4. Reconnect after the endpoint restarts: PASS

Five rounds on the emulator: open a connection, kill the endpoint, try again while it is down,
restart it on the same port, connect again.

- Each round the plugin reported `open`, then `error closed`, then `close 1006 closed`. One ending
  each time, no duplicates.
- While the endpoint was down, a new connection ended at once with `unreachable`.
- After each restart, a new connection opened.
- After the five rounds: `live: 0` connection tasks, `workers: 2`. The app process had 43 threads
  before and 43 after. The runtime's two workers show as `Thread-669` and `Thread-671`, because JNA
  attaches them to the JVM on their first callback.
- The host test `reconnecting_after_the_endpoint_restarts_leaks_nothing` does the same five rounds
  and counts the runtime's OS threads: 2.

### 5. A clean build succeeds: PASS

All generated outputs were moved out of the app directory: `www/`, `jniLibs/`, the Kotlin bindings,
the Gradle build directories, the copied web assets. Then `pnpm build:web`, `npx cap sync android`,
`scripts/build-android-rust.sh` and `./gradlew assembleDebug` all succeeded. The cargo build for both
ABIs took 39 s cold. The Gradle caches in `~/.gradle` were warm; the CI job is the cold check. The
debug APK is 66 MB: WE's build is 26 MB of it, and the barcode scanner's ML Kit library is about
11 MB.

### WE itself: PASS on WebView 124, FAIL on WebView 83

On `coasys-api35-webview`, WE's unchanged build connected through the plugin, signed in with the
token, and showed its own first-run screen ("What should we call you?"). The executor's events
subscription and status calls ran through the pinned socket.

On `coasys-api30` (WebView 83), WE's bundle does not parse (`SyntaxError: Unexpected token '='`).
WE builds with `target: 'esnext'`. The phone's own pages build for Chrome 83 and Safari 15, so the
pairing screen and all measurements above ran there.

## Problems found, and what was done

| Problem                                                                                                                                                                                        | Fix                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ad4m-connect does `GET <base>/health` with the global `fetch` before it opens the socket. The WebView refuses the self-signed certificate. A WebSocket switch alone left WE at "Connect AD4M". | Added `http_request` to the crate (same `dial`, same pin rule) and `installPinnedFetch` for the paired origin only. Text bodies only.                                                               |
| uniffi's Kotlin objects implement `AutoCloseable`, so `Connection.close()` would not compile.                                                                                                  | `uniffi.toml` renames it to `disconnect()` in Kotlin only. Swift keeps `close()`.                                                                                                                   |
| The release `.so` has no uniffi metadata (LTO and strip), so `uniffi-bindgen` found nothing in it.                                                                                             | The scripts read the bindings from a host debug build of the same source.                                                                                                                           |
| Connections stayed open in Rust after the WebView left the page that opened them.                                                                                                              | `reset()` closes them all. `PinnedWebSocket` calls it once per page, before its first connection. Capacitor's `WebViewListener.onPageStarted` did not fire for these navigations, so the page asks. |
| JNA ships natives for 32-bit ABIs. The app would install on a phone that cannot load the transport.                                                                                            | `abiFilters 'arm64-v8a', 'x86_64'`.                                                                                                                                                                 |
| The endpoint advertised a Docker bridge address (172.17.0.1).                                                                                                                                  | It ranks container and VM bridges last. `--advertise` overrides.                                                                                                                                    |
| The partial work had a sixth error kind, `protocol`.                                                                                                                                           | Removed. A refused WebSocket upgrade is `unreachable`, with the HTTP answer in the message. The five kinds are the closed set.                                                                      |
| The pinned executor was not in the local cache, and GitHub refused an anonymous download (rate limit).                                                                                         | `GITHUB_TOKEN=$(gh auth token) pnpm ad4m:executor`.                                                                                                                                                 |

What was kept from the partial work: the verifier, the pin format, the connection's event order,
the endpoint, and the host tests. All of it was correct. Changed: the error kinds, the dial
step (shared by socket and request), the endpoint's address choice, key reuse and `--names-only`,
the TLS 1.2 feature (tests only now), and the thread count in the reconnect test.

## What is not verified

- **iOS.** Linux cannot compile Swift or run Xcode. `CoasysTransportPlugin.swift`, `Package.swift`
  and `scripts/build-ios.sh` are written against the generated Swift API (checked by generating it
  on Linux), but never compiled. The CI macOS job builds only the XCFramework.
- **iOS Local Network permission.** Not tested: deny, then grant again. `Info.plist` has
  `NSLocalNetworkUsageDescription`.
- **A physical phone.** All numbers come from the emulator. Measure connect time and round trips on
  a phone over Wi-Fi.
- **QR scanning with a camera.** Not exercised.
- **Pipelined throughput.** Only sequential calls were measured. A burst of subscription events
  crosses the bridge one event at a time.
- **Binary HTTP bodies.** `installPinnedFetch` refuses them. The transcription audio feed sends one.

## What to decide next

These do not argue for another shell. They are conditions for using this one.

1. **WebView floor.** Android's system WebView updates through the Play Store, so real phones run a
   current one. But WE's `esnext` build fails on WebView 83. Set Capacitor's
   `android.minWebViewVersion` with an `errorPath` page, or build WE for a stated floor. This is a
   WebView fact, not a Capacitor fact: any WebView shell has it.
2. **A real switch in WE.** The spike patches `globalThis.WebSocket` and `globalThis.fetch`, and
   writes ad4m-connect's settings under its version-prefixed keys. That couples the phone to
   ad4m-connect's internals. ad4m-connect's `ApiClient` already takes `webSocketImpl` and
   `fetchImpl`. Let WE's connector pass them on the phone build.
3. **Bridge cost.** About 1.3 ms per round trip and about 550 sequential calls per second on the
   emulator. Enough for JSON-RPC. If a busy space floods subscription events, batch events in the
   plugin.
4. **Logs.** A debug build logs every plugin call to logcat, payload included: the executor token
   in the socket URL, and message text. Release builds do not (Capacitor's `loggingBehavior`
   defaults to `debug`). Keep it that way, and keep the token out of the URL.
5. **The token in JS.** The spike keeps the executor token in `localStorage` and passes it in the
   socket URL. Spike 2 moves keys out of JS.
