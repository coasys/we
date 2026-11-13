/**
 * What the Android app has to declare and configure for WE's page to work in it: the permissions a
 * call needs, and who keeps the page clear of the system bars.
 */
import { describe, expect, it } from 'vitest';

import manifest from '../android/app/src/main/AndroidManifest.xml?raw';
import mainActivity from '../android/app/src/main/java/org/coasys/app/MainActivity.java?raw';
import config from '../capacitor.config';

/** The `android:name` of every element of one kind, comments left out. */
function declared(element: 'uses-permission' | 'uses-feature'): Map<string, string> {
  const source = manifest.replace(/<!--[\s\S]*?-->/g, '');
  const found = new Map<string, string>();
  for (const [tag] of source.matchAll(new RegExp(`<${element}\\b[^>]*>`, 'g'))) {
    const name = /android:name="([^"]+)"/.exec(tag)?.[1];
    if (name) found.set(name, tag);
  }
  return found;
}

describe('a call in the WebView', () => {
  /*
    Capacitor's BridgeWebChromeClient.onPermissionRequest asks Android for CAMERA when a page wants
    video, and for RECORD_AUDIO and MODIFY_AUDIO_SETTINGS when it wants audio, and grants the page
    only if every one of them is granted. An undeclared permission is never granted and never even
    prompted for: without RECORD_AUDIO, getUserMedia({ audio }) failed on every phone, and a
    request for both failed whole.
  */
  it('declares every permission Capacitor asks for when a page captures audio and video', () => {
    const permissions = declared('uses-permission');
    for (const permission of ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
      expect(permissions.has(`android.permission.${permission}`), permission).toBe(true);
    }
  });

  it('runs on a phone without a camera or a microphone', () => {
    const features = declared('uses-feature');
    for (const feature of ['android.hardware.camera', 'android.hardware.microphone']) {
      expect(features.get(feature), feature).toMatch(/android:required="false"/);
    }
  });
});

describe('the system bars', () => {
  it('are kept clear by MainActivity, with Capacitor’s own insets handling off', () => {
    expect(config.plugins?.SystemBars?.insetsHandling).toBe('disable');
    expect(mainActivity).toMatch(/SafeArea\.INSTANCE\.install\(/);
  });
});
