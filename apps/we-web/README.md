# WE Web App

Browser-based launcher for the WE platform. This web application uses the `@we/app-framework` package to provide a platform-agnostic interface with web-specific authentication via `ad4m-connect`.

## What This App Does

The WE web launcher:

- Runs entirely in the browser (no installation required for the launcher itself)
- Authenticates with AD4M using the `ad4m-connect` desktop application
- Provides the same core functionality as the desktop launchers (Electron, Tauri)
- Shares the same codebase via `@we/app-framework`

## Architecture

- **Frontend** (`src/`): SolidJS app using the shared `@we/app-framework`
- **Platform Adapter** (`src/platform/webAdapter.ts`): Implements AD4M connection using `ad4m-connect`
- **Build Tool**: Vite with SolidJS plugin

## How it Works

Unlike the desktop apps which embed their own AD4M executor, the web app:

1. Connects to the `ad4m-connect` desktop application running on the user's machine
2. Requests authentication through ad4m-connect
3. Receives an authenticated AD4M client
4. Uses this client to connect to the user's AD4M executor

**Note:** Users must have:

- `ad4m-connect` desktop application installed and running
- AD4M executor running (managed by ad4m-connect)

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

1. Build the app with Vite
2. Output optimized static files to `dist/`
3. The build can be served from any static hosting (Vercel, Netlify, etc.)

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
- ❌ Requires ad4m-connect desktop app to be installed

### Electron / Tauri

- ✅ All-in-one installation (includes AD4M executor)
- ✅ Can embed external apps via iframe
- ✅ Direct access to system resources
- ❌ Larger download size (includes executor)
- ❌ Platform-specific builds
- ❌ Manual updates
- ❌ Screen sharing requires polyfill (Electron only)

## Platform Adapter

The web platform adapter uses `ad4m-connect` for authentication:

```typescript
// src/platform/webAdapter.ts
import Ad4mConnect from '@coasys/ad4m-connect';

export const webAdapter: PlatformAdapter = {
  async buildAd4mClient() {
    const connect = Ad4mConnect({
      appName: 'WE',
      appDesc: 'Social media for the new internet',
      appDomain: 'ad4m.weco.io',
      appIconPath: 'https://avatars.githubusercontent.com/u/34165012',
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    return await connect.getAd4mClient();
  },

  isDesktop: false,
  platform: 'web',
};
```

## Embedding External Apps

The web launcher can embed external apps via iframe using the same postMessage protocol as the desktop apps. See [`../EMBEDDING.md`](../EMBEDDING.md) for the complete integration guide.

**Advantages in Web:**

- Native `getDisplayMedia()` for screen sharing (no polyfill needed)
- Standard browser security model
- Works with any web-based embedded app

**Note:** The embedded app will receive AD4M credentials the same way as in desktop launchers, but the credentials come from `ad4m-connect` rather than a bundled executor.

## Deployment

### Static Hosting

Build the app and deploy the `dist/` folder to any static host:

```bash
pnpm build
# Upload dist/ to Vercel, Netlify, GitHub Pages, etc.
```

### Environment Variables

No environment variables required - all configuration is in `src/platform/webAdapter.ts`.

### CORS Considerations

The app communicates with the AD4M executor via WebSocket. Ensure your AD4M executor allows connections from your web app's domain.

## Troubleshooting

### "ad4m-connect not found"

Make sure the user has the `ad4m-connect` desktop application installed and running. Download it from the AD4M releases page.

### Connection Failed

1. Check that `ad4m-connect` desktop app is running
2. Verify the AD4M executor is running (managed by ad4m-connect)
3. Check firewall settings allow localhost connections
4. Ensure ad4m-connect is configured correctly

### Build Fails

If the build fails:

- Clear node_modules and reinstall: `rm -rf node_modules && pnpm install`
- Clear Vite cache: `rm -rf node_modules/.vite`
- Check that all workspace dependencies are built: `pnpm build` from root

## Related Apps

- `@we/we-electron` - Electron desktop launcher
- `@we/we-tauri` - Tauri desktop launcher

Both use the same `@we/app-framework` but with different platform adapters.

## License

MIT
