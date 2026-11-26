/**
 * What the Android app has to declare and configure for WE's page to work in it: the permissions a
 * call needs, and who keeps the page clear of the system bars.
 */
import { describe, expect, it } from 'vitest';

import { IDENTITY_PAGE } from '../../we-web/src/platform/phoneCustody';
import manifest from '../android/app/src/main/AndroidManifest.xml?raw';
import callerPage from '../android/app/src/main/java/org/coasys/app/devicekey/CallerPage.kt?raw';
import plugin from '../android/app/src/main/java/org/coasys/app/devicekey/DeviceKeyPlugin.kt?raw';
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

describe('what the identity plugin is handed', () => {
  it('is not logged by Capacitor, whose debug builds log every plugin call with its options', () => {
    expect(config.loggingBehavior).toBe('none');
  });

  it('cannot be reached over DevTools unless the build was synced to allow it', () => {
    expect(config.android?.webContentsDebuggingEnabled).toBe(false);
    expect(config.ios?.webContentsDebuggingEnabled).toBe(false);
  });
});

describe('who may call the identity plugin', () => {
  it('pins the identity page to the path WE leaves for', () => {
    expect(callerPage).toContain(`const val IDENTITY_PATH = "${IDENTITY_PAGE}"`);
  });

  it('checks the calling page on every method that runs through the worker, and names which pages', () => {
    const methods = [...plugin.matchAll(/@PluginMethod\s+fun (\w+)\(call: PluginCall\)([^{]*)\{/g)];
    expect(methods.length).toBeGreaterThan(15);
    for (const [, name, rest] of methods) {
      const asked =
        rest.includes('run(call, Caller.') ||
        plugin.includes(`fun ${name}(call: PluginCall) {\n    if (!callerAllowed(call, Caller.IDENTITY_PAGE)) return`);
      expect(asked, name).toBe(true);
    }
    expect(plugin).not.toMatch(/\brun\(call\)/);
  });

  it('leaves what links, sends the master key, renames or answers to the identity page alone', () => {
    for (const name of [
      'create',
      'join',
      'takeMaster',
      'askForMaster',
      'answer',
      'rename',
      'revoke',
      'linkNext',
      'linkConfirm',
      'linkCancel',
    ]) {
      expect(plugin, name).toMatch(
        new RegExp(`fun ${name}\\(call: PluginCall\\) = run\\(call, Caller\\.IDENTITY_PAGE\\)`),
      );
    }
    expect(plugin).toMatch(
      /fun scanDevice\(call: PluginCall\) \{\s+if \(!callerAllowed\(call, Caller\.IDENTITY_PAGE\)\) return/,
    );
  });

  it('takes the code of a device to add from the camera, never from the call', () => {
    const scanDevice = /fun scanDevice\([\s\S]*?\n  }\n/.exec(plugin)?.[0] ?? '';
    expect(scanDevice).toContain('ScanActivity');
    expect(scanDevice).not.toContain('getString');
    expect(plugin).not.toContain('scanDevice needs the device');
  });

  it('asks the person before it signs, renames, or sends the master key, and compares the match code itself', () => {
    expect(/fun signSession[\s\S]*?approve\(words\)/.test(plugin)).toBe(true);
    expect(/fun rename[\s\S]*?approve\(PromptText\.rename/.test(plugin)).toBe(true);
    expect(plugin).toMatch(/strongBiometricOnly = true/);
    expect(plugin).toMatch(/MatchCode\.matches\(claim\.code, typed\)/);
  });
});
