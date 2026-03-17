# Mobile Strategy for WE App Framework

## Overview

This document outlines the mobile strategy for the WE app framework, explaining the purpose of platform detection flags, mobile support options, and recommended implementation approach.

## Purpose of `isDesktop` Flag

The `isDesktop` flag in the platform adapter distinguishes between different runtime environments:

### Desktop Environments (Electron, Tauri)

- Full filesystem access
- Can run local AD4M instance
- Direct port/token access
- Native OS integration
- Unrestricted network access

### Web/Mobile Environments (Browser, PWA)

- Sandboxed environment
- Must connect to remote AD4M
- Uses `ad4m-connect` authentication
- Limited OS access
- Browser security restrictions

### Current Usage

```typescript
if (platform.isDesktop) {
  // Can access local AD4M directly
  const { port, token } = await platform.getConnectionDetails();
} else {
  // Must use ad4m-connect (browser auth flow)
  const client = await ad4mConnect();
}
```

## Mobile Support Options

### Option 1: PWA (Recommended for Quick Start) ✅

**Use existing `we-web` as a Progressive Web App:**

#### Setup

```json
// we-web/public/manifest.json
{
  "name": "WE",
  "short_name": "WE",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#667eea",
  "background_color": "#ffffff",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "orientation": "any",
  "categories": ["productivity", "social"]
}
```

#### Platform Adapter

```typescript
// we-web/src/platform/webAdapter.ts
import type { PlatformAdapter } from '@we/app-framework/shared';

export const webAdapter: PlatformAdapter = {
  async buildAd4mClient() {
    // Works on mobile browsers too
    return await ad4mConnect();
  },
  isDesktop: false,
  isMobile: typeof navigator !== 'undefined' && /mobile/i.test(navigator.userAgent),
  isWeb: true,
  platform: 'web',
};
```

#### Benefits

- ✅ Works immediately with existing code
- ✅ No app store approval needed
- ✅ Cross-platform (iOS, Android, desktop browsers)
- ✅ Automatic updates
- ✅ Small download size
- ✅ No installation friction

#### Limitations

- ❌ No filesystem access
- ❌ Limited background processing
- ❌ Must connect to remote AD4M
- ❌ Less "native" feel
- ❌ Limited access to device features

### Option 2: Capacitor (Recommended for Full Mobile App) ✅✅

**Capacitor wraps your web app as native iOS/Android:**

#### Installation

```bash
# Install Capacitor
pnpm add @capacitor/core @capacitor/cli
pnpm add @capacitor/ios @capacitor/android

# Initialize
pnpm cap init

# Add platforms
pnpm cap add ios
pnpm cap add android
```

#### Configuration

```typescript
// capacitor.config.ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.we.app',
  appName: 'WE',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#667eea',
      showSpinner: true,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#667eea',
    },
  },
};

export default config;
```

#### Platform Adapter

```typescript
// apps/we-mobile/src/platform/capacitorAdapter.ts
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import type { PlatformAdapter } from '@we/app-framework/shared';

export const capacitorAdapter: PlatformAdapter = {
  async buildAd4mClient() {
    // Try to connect to local AD4M if available
    // Otherwise use ad4m-connect
    if (await isAd4mAvailable()) {
      return connectToLocalAd4m();
    }
    return await ad4mConnect();
  },

  async getConnectionDetails() {
    // Mobile-specific: might run AD4M in background service
    return await getMobileAd4mConnection();
  },

  isDesktop: false,
  isMobile: true,
  isWeb: false,
  platform: 'capacitor',
  nativePlatform: Capacitor.getPlatform(), // 'ios' | 'android'

  capabilities: {
    filesystem: true,
    localAd4m: false, // Initially
    notifications: true,
    camera: true,
    biometrics: true,
  },
};
```

#### Benefits

- ✅ True native app experience
- ✅ Access to native APIs (camera, notifications, biometrics, etc.)
- ✅ Better performance than PWA
- ✅ App store distribution
- ✅ Can run local services (potentially AD4M)
- ✅ Offline-first capabilities
- ✅ Native UI chrome (status bar, navigation)

#### Tradeoffs

- ⚠️ Requires app store approval
- ⚠️ More complex build process
- ⚠️ Larger download size (~50-100MB)
- ⚠️ Need to maintain iOS/Android builds
- ⚠️ Updates require app store review (for native code changes)

### Option 3: Tauri Mobile (Experimental) ⚠️

**Tauri v2 has mobile support (iOS/Android):**

#### Setup

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri = { version = "2.0.0", features = ["mobile"] }

[target.'cfg(target_os = "ios")'.dependencies]
tauri = { version = "2.0.0", features = ["mobile", "ios"] }

[target.'cfg(target_os = "android")'.dependencies]
tauri = { version = "2.0.0", features = ["mobile", "android"] }
```

```rust
// src-tauri/mobile/src/lib.rs
#[cfg(mobile)]
use tauri::mobile::run_mobile;

#[cfg(mobile)]
pub fn main() {
    run_mobile();
}
```

#### Benefits

- ✅ Same codebase as desktop Tauri
- ✅ Rust backend on mobile
- ✅ Could run AD4M natively on device
- ✅ Better performance than web-based solutions
- ✅ Smaller bundle size than Electron

#### Limitations

- ❌ Still in beta/early release (Tauri 2.0)
- ❌ Limited documentation
- ❌ Fewer plugins than Capacitor
- ❌ Steeper learning curve (Rust required)
- ❌ Less mature ecosystem
- ❌ Might be overkill for MVP

### Option 4: Electron (Not Recommended) ❌

**Electron does NOT support mobile.** Don't use for mobile apps.

## Recommended Architecture

### Updated Platform Adapter Interface

```typescript
// packages/app-framework/src/shared/platform/types.ts
export interface PlatformAdapter {
  buildAd4mClient(): Promise<Ad4mClient>;
  getConnectionDetails?(): Promise<{ port: number; token: string }>;

  // Platform metadata
  isDesktop: boolean;
  isMobile?: boolean;
  isWeb?: boolean;
  platform: 'web' | 'electron' | 'tauri' | 'capacitor';

  // Optional: Native platform for mobile/desktop
  nativePlatform?: 'ios' | 'android' | 'windows' | 'macos' | 'linux';

  // Capabilities for conditional features
  capabilities?: {
    filesystem: boolean;
    localAd4m: boolean;
    notifications: boolean;
    camera: boolean;
    biometrics: boolean;
    backgroundSync: boolean;
    share: boolean;
  };
}
```

### Platform Detection Utility

```typescript
// packages/app-framework/src/shared/platform/detect.ts
export function detectPlatform(): Partial<PlatformAdapter> {
  // Check if running in Capacitor
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    const Capacitor = (window as any).Capacitor;
    return {
      platform: 'capacitor',
      isMobile: true,
      isDesktop: false,
      isWeb: false,
      nativePlatform: Capacitor.getPlatform(),
    };
  }

  // Check if running in Tauri
  if (typeof window !== 'undefined' && (window as any).__TAURI__) {
    return {
      platform: 'tauri',
      isDesktop: true, // Assume desktop for now (until Tauri mobile is stable)
      isWeb: false,
    };
  }

  // Check if running in Electron
  if (typeof window !== 'undefined' && (window as any).electron) {
    return {
      platform: 'electron',
      isDesktop: true,
      isWeb: false,
    };
  }

  // Default to web
  const isMobileUA = typeof navigator !== 'undefined' && /mobile/i.test(navigator.userAgent);
  return {
    platform: 'web',
    isDesktop: false,
    isMobile: isMobileUA,
    isWeb: true,
  };
}
```

### Conditional UI Based on Platform

```typescript
// Example component that adapts to platform
import { usePlatform } from '@we/app-framework/shared';
import { Show } from 'solid-js';

export function AdaptiveLayout() {
  const platform = usePlatform();

  return (
    <Show when={platform.isMobile} fallback={<DesktopLayout />}>
      <MobileLayout />
    </Show>
  );
}

export function FeatureButton() {
  const platform = usePlatform();

  return (
    <Show when={platform.capabilities?.camera}>
      <we-button onClick={openCamera}>
        <we-icon name="camera" />
        Take Photo
      </we-button>
    </Show>
  );
}

export function NavigationBar() {
  const platform = usePlatform();

  // Mobile: bottom nav, Desktop: sidebar
  return (
    <Show when={platform.isMobile} fallback={<Sidebar />}>
      <BottomNavigation />
    </Show>
  );
}
```

## Project Structure for Mobile

```
apps/
├── we-web/              # PWA (works on mobile browsers)
│   ├── public/
│   │   └── manifest.json
│   └── src/
│       └── platform/
│           └── webAdapter.ts
│
├── we-electron/         # Desktop (Windows, macOS, Linux)
│   └── src/
│       └── platform/
│           └── electronAdapter.ts
│
├── we-tauri/            # Desktop + future mobile
│   ├── src-tauri/
│   │   └── mobile/     # Mobile-specific Rust code
│   └── src/
│       └── platform/
│           └── tauriAdapter.ts
│
└── we-mobile/           # Capacitor mobile app (NEW)
    ├── src/
    │   ├── platform/
    │   │   └── capacitorAdapter.ts
    │   └── main.tsx
    ├── ios/             # Generated by Capacitor
    ├── android/         # Generated by Capacitor
    ├── capacitor.config.ts
    └── package.json
```

## Mobile-Specific Considerations

### 1. AD4M Connection Strategy

```typescript
// Mobile might not run local AD4M (initially)
export const mobileAdapter: PlatformAdapter = {
  async buildAd4mClient() {
    // Option A: Connect to user's remote AD4M (cloud/home server)
    if (await hasRemoteAd4mConfig()) {
      return connectToRemoteAd4m();
    }

    // Option B: Use ad4m-connect (requires browser auth)
    return await ad4mConnect();

    // Option C: Future - run lightweight AD4M on mobile
    // This could be implemented as a Capacitor plugin or background service
    // return await startMobileAd4m();
  },

  capabilities: {
    localAd4m: false, // Set to true when mobile AD4M is ready
    // ...
  },
};
```

### 2. Storage Strategy

```typescript
// Mobile has limited storage
export const mobileStorageStrategy = {
  // Cache only recent/important data
  cacheStrategy: 'lru', // Least Recently Used
  maxCacheSize: '100MB',

  // Sync to remote
  syncToRemote: true,
  syncInterval: 'on-wifi', // Don't use cellular data

  // Download on-demand
  lazyLoad: true,

  // Compress data
  compression: true,
};
```

### 3. UI Adaptations

```scss
// Responsive design system
.we-component {
  // Desktop
  @media (min-width: 1024px) {
    --sidebar-width: 240px;
    --content-padding: 2rem;
    --font-scale: 1;
  }

  // Tablet
  @media (min-width: 768px) and (max-width: 1023px) {
    --sidebar-width: 200px;
    --content-padding: 1.5rem;
    --font-scale: 0.95;
  }

  // Mobile
  @media (max-width: 767px) {
    --sidebar-width: 100vw; // Full screen
    --content-padding: 1rem;
    --font-scale: 0.9;
  }
}

// Touch-friendly buttons on mobile
.we-button {
  @media (max-width: 767px) {
    min-height: 44px; // iOS recommended touch target
    min-width: 44px;
  }
}

// Bottom navigation on mobile
.navigation {
  @media (max-width: 767px) {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
  }
}
```

### 4. Performance Optimizations

```typescript
// Lazy load heavy components on mobile
export const HeavyComponent = lazy(() =>
  import('./HeavyComponent')
);

export function App() {
  const platform = usePlatform();

  return (
    <Show
      when={!platform.isMobile || userRequestedFeature()}
      fallback={<LightweightAlternative />}
    >
      <Suspense fallback={<Spinner />}>
        <HeavyComponent />
      </Suspense>
    </Show>
  );
}
```

### 5. Network Awareness

```typescript
// Use Network Information API on mobile
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = createSignal(navigator.onLine);
  const [isWifi, setIsWifi] = createSignal(false);

  onMount(() => {
    const connection = (navigator as any).connection;
    if (connection) {
      setIsWifi(connection.type === 'wifi');
      connection.addEventListener('change', () => {
        setIsWifi(connection.type === 'wifi');
      });
    }
  });

  return { isOnline, isWifi };
}

// Only sync heavy data on WiFi
export function SmartSync() {
  const { isWifi } = useNetworkStatus();

  createEffect(() => {
    if (isWifi()) {
      syncLargeFiles();
    }
  });
}
```

## Implementation Roadmap

### Phase 1: PWA (Immediate - Week 1)

**Effort:** Low | **Impact:** High | **Time:** 1 week

- [ ] Add PWA manifest to `we-web`
- [ ] Add service worker for offline support
- [ ] Test on mobile browsers (iOS Safari, Chrome Android)
- [ ] Add "Add to Home Screen" prompt
- [ ] Update platform adapter with mobile detection
- [ ] Test responsive layouts

**Result:** Mobile-accessible WE app without app stores

### Phase 2: Mobile UI Refinements (Month 1-2)

**Effort:** Medium | **Impact:** High | **Time:** 4-6 weeks

- [ ] Update design system for touch targets
- [ ] Implement bottom navigation for mobile
- [ ] Add mobile-specific gestures (swipe, pull-to-refresh)
- [ ] Optimize performance for mobile devices
- [ ] Add network-aware syncing
- [ ] Implement mobile-friendly forms and inputs

**Result:** Polished mobile web experience

### Phase 3: Capacitor Mobile App (Month 3-6)

**Effort:** High | **Impact:** Very High | **Time:** 12-16 weeks

- [ ] Create `we-mobile` app with Capacitor
- [ ] Implement native features:
  - [ ] Push notifications
  - [ ] Camera integration
  - [ ] Biometric authentication
  - [ ] Share functionality
  - [ ] Background sync
- [ ] Setup iOS build pipeline
- [ ] Setup Android build pipeline
- [ ] Submit to App Store
- [ ] Submit to Play Store

**Result:** Native mobile apps on iOS and Android

### Phase 4: Tauri Mobile (Month 12+)

**Effort:** Very High | **Impact:** Medium | **Time:** 16+ weeks

- [ ] Wait for Tauri 2.0 stable release
- [ ] Evaluate mobile AD4M runtime
- [ ] Prototype Tauri mobile build
- [ ] Compare with Capacitor performance
- [ ] Decide on consolidation strategy

**Result:** Potentially unified desktop/mobile codebase with Rust backend

## Testing Strategy

### PWA Testing

```bash
# Test PWA locally
pnpm lighthouse:mobile

# Test on real devices via ngrok/localtunnel
pnpm dev:mobile
```

### Capacitor Testing

```bash
# iOS Simulator
pnpm cap run ios

# Android Emulator
pnpm cap run android

# Real device testing
pnpm cap open ios  # Use Xcode
pnpm cap open android  # Use Android Studio
```

### Cross-Platform Testing Matrix

| Feature            | Web | PWA | Capacitor iOS | Capacitor Android | Tauri Desktop |
| ------------------ | --- | --- | ------------- | ----------------- | ------------- |
| AD4M Connect       | ✅  | ✅  | ✅            | ✅                | ✅            |
| Local AD4M         | ❌  | ❌  | 🔄 Future     | 🔄 Future         | ✅            |
| Offline Mode       | ⚠️  | ✅  | ✅            | ✅                | ✅            |
| Push Notifications | ❌  | ⚠️  | ✅            | ✅                | ✅            |
| Camera             | ⚠️  | ⚠️  | ✅            | ✅                | ✅            |
| Biometrics         | ❌  | ❌  | ✅            | ✅                | ⚠️            |
| File System        | ❌  | ⚠️  | ✅            | ✅                | ✅            |

## Recommended Approach 🎯

### Immediate (Now)

**Start with PWA** - Add manifest and service worker to existing `we-web`

- Zero additional effort for mobile support
- Works across all mobile browsers
- Good for MVP and testing

### Short Term (3-6 months)

**Build Capacitor App** - Create dedicated mobile app with native features

- Better user experience
- App store presence
- Access to native device features
- Still uses web technologies (familiar stack)

### Long Term (12+ months)

**Evaluate Tauri Mobile** - Consider when stable

- Potentially unify desktop and mobile codebases
- Run AD4M natively on mobile devices
- Better performance
- Wait for ecosystem maturity

### Summary

The WE app framework is **already designed** to support mobile through its platform adapter system. The `isDesktop` flag exists to handle the fundamental difference between environments that can run local AD4M (desktop) vs. those that connect remotely (web/mobile).

**Key takeaways:**

1. PWA = quickest path to mobile support
2. Capacitor = best mobile app experience with familiar tech stack
3. Tauri = future possibility but not ready yet
4. Update platform adapter interface to include mobile capabilities
5. Design system should be responsive and touch-friendly
6. Consider network and storage constraints on mobile devices

The app framework's platform abstraction makes all of this possible with minimal code changes! 🚀
