# Embedding External Apps via iframe

> The launcher side of this contract is implemented in
> `packages/app-shell/src/frameworks/solid/services/appBridge.ts` — read its
> header for the full choreography (config handoff, the web host's postMessage
> GraphQL proxy, and the buffering that covers an iframe asking before boot
> finishes).

> **Example:** This guide uses Flux as a concrete example, but the pattern works for any external app you want to embed in the WE launcher.

## How AD4M Config is Passed to Embedded Apps

The parent launcher app (we-electron or we-tauri) embeds external apps in an iframe using the `we-iframe` component. To share the AD4M connection details (port + token) with the embedded app, we use a **request-response pattern** with the `postMessage` API.

### Parent Launcher Flow (`appBridge.ts` in @we/app-shell)

1. **On initialization**, the parent launcher:
   - Starts the AD4M executor
   - Gets the port and token from the platform adapter
   - Sets up a **message listener** for `REQUEST_AD4M_CONFIG` events

2. **When embedded app requests config**, the parent launcher:
   - Responds with `AD4M_CONFIG` message containing port and token
   - This happens when the iframe sends `REQUEST_AD4M_CONFIG`

### Embedded App Flow (Example: Flux app.ts)

**For your embedded app to receive AD4M credentials:**

1. **Detect if running in iframe** - Check if your app is embedded or standalone
2. **Set up listener** for `AD4M_CONFIG` response from parent
3. **Immediately send** `REQUEST_AD4M_CONFIG` to parent
4. **Receive config** and build Ad4mClient
5. **Initialize your app** after client is ready

```javascript
// Example from flux/app/src/app.ts

// Detect if running in an iframe (embedded) vs standalone
const isEmbedded = window.self !== window.top;

if (isEmbedded) {
  // Running in launcher - request AD4M config from parent

  // 1. Set up listener for config response FIRST
  window.addEventListener('message', async (event) => {
    if (event.data.type === 'AD4M_CONFIG') {
      const { port, token } = event.data;

      // 2. Build Ad4mClient with received credentials
      const ad4mClient = buildAd4mClientFromConfig(port, token);
      appStore.setAdamClient(ad4mClient);

      // 3. Wait for profile to load before mounting
      await appStore.refreshMyProfile();

      // 4. Mount the app
      vueApp.mount('#app');
    }
  });

  // 5. Request the config from parent
  window.parent.postMessage({ type: 'REQUEST_AD4M_CONFIG' }, '*');
} else {
  // Running standalone - use ad4m-connect or your own auth method
  // ... your standalone initialization code
}
```

**Note:** `window.self !== window.top` returns `true` when your app is running in an iframe, `false` when running standalone.

### Why This Approach?

- **Iframe controls timing**: Flux requests config only when it's ready to receive
- **No race conditions**: Works regardless of which loads first (parent or iframe)
- **No arbitrary timeouts**: Request-response is deterministic
- **Can't pass Ad4mClient directly**: Objects can't be serialized through postMessage

### Message Flow

```
Embedded App (iframe)           Parent Launcher
    |                                |
    | ----REQUEST_AD4M_CONFIG---->   |
    |                                |
    |   <----AD4M_CONFIG-----------  |
    |   (port, token)                |
    |                                |
```

### Testing

**Example with Electron:**

1. Start the Electron app: `pnpm electron:dev` (from we-electron)
2. Log in with your password
3. Navigate to your embedded app's route
4. Check console - you should see:
   ```
   [YourApp]: Received AD4M_CONFIG message { port: 12000 }
   [YourApp]: App initialized
   ```

**Example with Tauri:**
Similar flow, just run `pnpm tauri:dev` instead.
