# AGENTS.md: identity-site

Read `README.md` first. Rules for changes here:

## Commands

- `unset NODE_ENV` before `pnpm install` (the install skips dev dependencies otherwise).
- From the WE root: `pnpm --filter @we/identity-site typecheck | test | test:e2e`. `build` needs `COASYS_STORE_KEY=did:key:...` (any `did:key:` value works for a local build).
- Run `pnpm test` without `COASYS_STORE_KEY` set: one test checks that a missing key is refused.

## Layout

This is `apps/identity-site` in the WE workspace. Its deploy is `.github/workflows/identity-site-deploy.yaml` at the repo root, and its owners are in `.github/CODEOWNERS`.

## Rules

- No inline script, no inline style, no `innerHTML`; the CSP forbids them and a test reads the source for them. Use `textContent` and DOM calls. The QR code is an `<img>` with a `data:` URL (the portal draws it); the policy allows `img-src data:` for that.
- `headers.ts` is the only source of the header set. Change it there; `tests/build.test.ts` reads the built `dist/_headers`.
- Cloudflare Pages adds the headers of every `_headers` rule that matches a path and cannot remove one. Keep one rule per route, with its whole header set, and no overlap.
- `/connect` is the only route that may be framed (`frame-ancestors` from `frameOrigins`). Every other route sends `X-Frame-Options: DENY`.
- Nothing test-only goes in `src/`. Fakes live in `tests/` and `e2e/`, at the network edge (HTTP and WebSocket servers), not inside the code.
- No crypto and no wire format is written here. Every one comes from `@coasys/identity-wasm`; the browser's WebCrypto only signs the bytes a `*Bytes` export returns. A failed check throws a plain `{code, reason, detail}`.
- The signing key is non-extractable. The X25519 secret is only ever AES-GCM ciphertext at rest, and an `EncKey` is `free()`d after use (`withEnc`). Do not add a fallback or an exportable key.
- The picker lists only the person's own devices from their private record, never a host or a platform list.
- The frame answers only the exact `event.origin` the registry knows. Never post an answer to `'*'` (only `ready`, which has no secret).

## Gotchas

- IndexedDB is partitioned by embedding site: the key in the frame under an app is not the key of `/connect` opened as a top-level page.
- WebKit stores an X25519 `CryptoKey` in IndexedDB but throws a `DataCloneError` when it reads one back. That is why the secret is wrapped, and why the e2e tests run in WebKit too.
- Playwright's WebKit on a minimal Linux machine can lack system libraries (`libavif`, `libmanette`, `libyuv`, `libgav1`, `libhidapi`). Its `MiniBrowser` launcher overwrites `LD_LIBRARY_PATH`, so install them with the system package manager, or point `executablePath` at a launcher script of your own that adds their folder; do not edit Playwright's shared browser cache.
- The e2e build is `COASYS_ENV=e2e`: it has no `upgrade-insecure-requests`, no HSTS, and `connect-src` adds local `http:` and `ws:` origins. Never deploy it.
- The WASM bundle needs `'wasm-unsafe-eval'` in `script-src`, on `/connect` only (`headers.ts`); no route allows `unsafe-eval`.
- Fixtures (`tests/fixtures/world.json`) are of one moment; tests set the clock to `world.now`. Regenerate them with `world-generator.rs.txt` from an ad4m checkout when the wire formats change.
