# WE Web App

Browser-based launcher for the WE platform. It uses the `@we/app-shell` package for a
platform-agnostic interface, and signs in with Coasys Connect (`@coasys/connect`).

## What This App Does

The WE web launcher:

- Runs entirely in the browser (no installation required for the launcher itself)
- Signs in with Coasys Connect: the browser links to an identity that one of the person's own
  devices holds
- Provides the same core functionality as the desktop launchers (Electron, Tauri)
- Shares the same codebase via `@we/app-shell`

## Architecture

- **Frontend** (`src/`): SolidJS app using the shared `@we/app-shell`
- **Connectors** (`src/platform/`): `ad4mConnector.ts` (Coasys Connect), `guestConnector.ts` (a
  guest on a node a link names), `bootSession.ts` (a session the embedding host hands over)
- **Endpoints** (`config/<COASYS_ENV>.json`, read by `config/endpoints.mjs`): the identity origin,
  the platform API origin and the store origin of this build. `COASYS_ENV` picks the file
  (`production` is the default).
- **Build Tool**: Vite with SolidJS plugin

## How it Works

Unlike the desktop apps, which embed their own AD4M executor, the web app has no keys of its own.
At start it takes one of three ways in, in this order:

1. **A boot session**, when the host that serves the page sets `window.__WE_AD4M_SESSION`
   (see below).
2. **A guest session**, when the page was opened from a guest link (`/join/<space>?host=<url>`), or
   when this tab was a guest before a reload.
3. **Coasys Connect**. The signed-out screen offers **Link this browser**: it shows a link and a
   QR code. The person opens the link in a Coasys app that holds their identity (the desktop
   identity window, or the phone app), compares the match code on both screens, and confirms. The
   browser then holds a device key of its own. It never holds the master key. Devices lists it as a
   browser with its last use, and **Revoke device key** removes it.

The session token stays in this page's memory. Nothing in `localStorage` or `sessionStorage` holds
it, so a reload signs in again through Connect (the identity frame renews it). The one thing kept
is a guest tab's host address in `sessionStorage`, so a reloaded guest tab stays a guest; it is
gone with the tab.

## The boot session

A host that already holds a token for an executor (the ad4m Docker entrypoint, the SFU's Electron
client) sets one global before WE's script runs:

```js
window.__WE_AD4M_SESSION = { url: 'http://127.0.0.1:12000', token: '<token>' };
```

- `url` is the executor: an `http(s)` or `ws(s)` address.
- `token` is a token that executor issued: a grant, or its operator credential.

WE reads it once, at start, and removes it from `window`. It writes it nowhere. WE does not renew
the token: the host that issued it owns its lifetime. A value that is not `{ url, token }` is
logged to the console and ignored; the app then starts as if the host had set none. A boot
session wins over a guest link in the same page.

## Development

To run in development mode:

```bash
pnpm dev
```

This will:

1. Start the Vite dev server (default port: 3000)
2. Open the app in your browser
3. Enable hot module reloading

## Building

To build for production:

```bash
pnpm build
```

This will:

1. Build the app with Vite, with the endpoints of `COASYS_ENV` (`production` or `staging`)
2. Output optimized static files to `dist/`
3. The build can be served from any static hosting (Cloudflare Pages, etc.)

## Preview Production Build

To preview the production build locally:

```bash
pnpm serve
```

## Differences from Desktop Apps

### Web (this app)

- ✅ Launcher runs in browser (no launcher installation)
- ✅ Cross-platform (works on any OS with a browser)
- ✅ Auto-updates (just refresh the page)
- ✅ Native browser APIs (screen sharing works out of the box)
- ✅ Can embed external apps via iframe (same postMessage pattern)
- ❌ Needs one of the person's own devices to link the browser first

### Electron / Tauri

- ✅ All-in-one installation (includes AD4M executor)
- ✅ Can embed external apps via iframe
- ✅ Direct access to system resources
- ❌ Larger download size (includes executor)
- ❌ Platform-specific builds
- ❌ Manual updates
- ❌ Screen sharing requires polyfill (Electron only)

## Embedding External Apps

The web launcher can embed external apps via iframe using the same postMessage protocol as the desktop apps. See [`embedding-external-apps.md`](../../docs/guides/embedding-external-apps.md) for the complete integration guide.

**Advantages in Web:**

- Native `getDisplayMedia()` for screen sharing (no polyfill needed)
- Standard browser security model
- Works with any web-based embedded app

**Note:** The embedded app receives AD4M credentials the same way as in desktop launchers, but the credentials come from Coasys Connect (or the boot session) rather than a bundled executor.

## Deployment

### Static Hosting

Build the app and deploy the `dist/` folder to any static host:

```bash
pnpm build
# Upload dist/ to Cloudflare Pages, GitHub Pages, etc.
```

### Environment Variables

`COASYS_ENV` (`production` or `staging`) picks `config/<COASYS_ENV>.json` at build time. Nothing
else is read from the environment.

### CORS Considerations

The app talks to the AD4M executor over HTTP and WebSocket. Ensure the executor allows connections
from your web app's domain.

## Troubleshooting

### The sign-in does not finish

1. Check that the identity origin in `config/<COASYS_ENV>.json` is reachable from the browser.
2. Check that the device that opens the link uses the same identity store as the browser.
3. A link expires after five minutes: use **Link this browser** again for a new one.

### Build Fails

- Clear node_modules and reinstall: `rm -rf node_modules && pnpm install`
- Clear Vite cache: `rm -rf node_modules/.vite`
- Check that all workspace dependencies are built: `pnpm build` from root

## Related Apps

- `@we/we-electron` - Electron desktop launcher
- `@we/we-tauri` - Tauri desktop launcher

Both use the same `@we/app-shell` but with different platform adapters.

## License

MIT
