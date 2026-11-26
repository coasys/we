/**
 * What the Android app has to declare and configure for WE's page to work in it: the permissions a
 * call needs, and who keeps the page clear of the system bars.
 */
import { describe, expect, it } from 'vitest';

import { IDENTITY_PAGE } from '../../we-web/src/platform/phoneCustody';
import appBuild from '../android/app/build.gradle?raw';
import manifest from '../android/app/src/main/AndroidManifest.xml?raw';
import callerPage from '../android/app/src/main/java/org/coasys/app/devicekey/CallerPage.kt?raw';
import clientSource from '../android/app/src/main/java/org/coasys/app/devicekey/CallerWebViewClient.kt?raw';
import plugin from '../android/app/src/main/java/org/coasys/app/devicekey/DeviceKeyPlugin.kt?raw';
import transportWebView from '../android/app/src/main/java/org/coasys/app/devicekey/TransportWebView.kt?raw';
import mainActivity from '../android/app/src/main/java/org/coasys/app/MainActivity.java?raw';
import layout from '../android/app/src/main/res/layout/capacitor_bridge_layout_main.xml?raw';
import config from '../capacitor.config';
import capacitorLayout from '../node_modules/@capacitor/android/capacitor/src/main/res/layout/capacitor_bridge_layout_main.xml?raw';

/** The TypeScript that calls the plugin: the phone's identity page and WE's platform layer. */
const callers = import.meta.glob<string>(['../src/**/*.ts', '../../we-web/src/platform/*.ts', '!**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The load adapter's code, its comments left out. */
const client = clientSource.replace(/\/\*[\s\S]*?\*\//g, '');

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
        new RegExp(
          `fun ${name}\\(call: PluginCall\\) \\{\\n    (val ticket = )?callerTicket\\(call, Caller\\.IDENTITY_PAGE\\) \\?: return`,
        ).test(plugin);
      expect(asked, name).toBe(true);
    }
    expect(plugin).not.toMatch(/\brun\(call\)/);
  });

  it('marks every method the TypeScript calls as a plugin method, which Capacitor only then reaches', () => {
    const called = new Set<string>();
    for (const source of Object.values(callers)) {
      for (const [, name] of source.matchAll(/\bplugin\.(\w+)\(/g)) called.add(name);
    }
    expect(called.has('linkNext')).toBe(true);
    for (const name of called) {
      expect(plugin, name).toMatch(new RegExp(`@PluginMethod\\s+fun ${name}\\(call: PluginCall\\)`));
    }
    // Every method that takes a call is reachable: none is left without the annotation.
    for (const [, name] of plugin.matchAll(/^ {2}fun (\w+)\(call: PluginCall\)/gm)) {
      expect(plugin, name).toMatch(new RegExp(`@PluginMethod\\s+fun ${name}\\(call: PluginCall\\)`));
    }
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
      /fun scanDevice\(call: PluginCall\) \{\s+val ticket = callerTicket\(call, Caller\.IDENTITY_PAGE\) \?: return/,
    );
  });

  it('binds the caller to the loaded document, never to the history address a script can rewrite', () => {
    // WebView.url is the current history entry: pushState changes it with no document load.
    // The plugin's only `.url` is the sign-in request's own; the load adapter reads none.
    expect([...plugin.matchAll(/\.url\b/g)].length).toBe(1);
    expect(plugin).not.toContain('WebViewListener');
    expect(client).not.toMatch(/\.url\b/);
    expect(client).not.toContain('WebViewListener');
    expect(client).toContain('BridgeWebViewClient(calls)');
    // A barrier on the plugin's call queue at each commit: calls the old document queued run first.
    expect(client).toMatch(
      /document\.committed\(url\) \?: return\s+calls\.execute \{ document\.drained\(generation\) \}/,
    );
    expect(client).toMatch(/super\.onPageStarted\(view, url, favicon\)\s+document\.started\(url\)/);
    expect(client).toMatch(/super\.onPageCommitVisible\(view, url\)[\s\S]*?document\.committed\(url\)/);
    expect(client).toMatch(/super\.onPageFinished\(view, url\)\s+document\.finished\(url\)/);
    expect(plugin).toContain('bridge.webViewClient = CallerWebViewClient(bridge, document)');
    expect(mainActivity).toContain('installPageGate()');
    expect(plugin).not.toContain('CallerPage.isIdentityPage');
  });

  it('refuses every call unless Capacitor really installed the web-message listener', () => {
    // 8.6.3's MessageHandler falls back to addJavascriptInterface, unsaid, when the feature is
    // unsupported or addWebMessageListener throws; the config alone does not show it.
    expect(plugin).toMatch(/fun requireCaller[\s\S]*?if \(!viaWebMessageListener\(\)\) throw Refusal\("NotAllowed"/);
    expect(plugin).toContain('WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)');
    expect(plugin).toContain('bridge.config?.isUsingLegacyBridge');
    expect(plugin).toContain('bridge.webView as? TransportWebView');
    expect(transportWebView).toMatch(/override fun addJavascriptInterface[\s\S]*?bridgeInterfaceInstalled = true/);
    // The layout is Capacitor's, with only its WebView class replaced.
    const normalise = (xml: string) =>
      xml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/com\.getcapacitor\.CapacitorWebView|org\.coasys\.app\.devicekey\.TransportWebView/g, 'WEBVIEW')
        .replace(/\s+/g, ' ');
    expect(layout).toContain('<org.coasys.app.devicekey.TransportWebView');
    expect(normalise(layout)).toBe(normalise(capacitorLayout));
    expect(appBuild).toMatch(/implementation "androidx\.webkit:webkit:\$androidxWebkitVersion"/);
  });

  it('checks the document when the worker starts, before the body', () => {
    expect(plugin).toMatch(
      /pool\.execute \{\s+try \{[^}]*?stillHolds\(ticket\)\s+sweepLinks\(\)\s+val out = body\(ticket\)/,
    );
    expect(plugin).toMatch(/fun linkNext[\s\S]*?stillHolds\(ticket\)\s+val step = held\.link\.next\(\)/);
    expect(plugin).toMatch(
      /fun deviceScanned[\s\S]*?pool\.execute[\s\S]*?document\.holds\(ticket\)\) throw[\s\S]*?identity\(\)\.scanDevice/,
    );
  });

  it('checks again after a prompt, a scan or a wait, before it signs or mutates', () => {
    expect(plugin).toMatch(/if \(!prompt\.confirm[\s\S]*?stillHolds\(ticket\)/);
    expect(plugin).toMatch(/fun deviceScanned[\s\S]*?takeScanTicket[\s\S]*?document\.holds\(ticket\)/);
    expect(plugin).toMatch(/fun scanned[\s\S]*?takeScanTicket/);
    expect(plugin).toMatch(
      /fun linkConfirm[\s\S]*?askForMatchCode[\s\S]*?stillHolds\(ticket\)[\s\S]*?held\.link\.confirm/,
    );
    expect(plugin).toMatch(/fun startFlow[\s\S]*?agreeToWeakProtection[\s\S]*?stillHolds\(ticket\)\s+start\(true\)/);
    expect(plugin).toMatch(/fun setSecure[\s\S]*?runOnUiThread \{[\s\S]*?document\.holds\(ticket\)[\s\S]*?FLAG_SECURE/);
  });

  it('takes the code of a device to add from the camera, never from the call', () => {
    const scanDevice = /fun scanDevice\([\s\S]*?\n  }\n/.exec(plugin)?.[0] ?? '';
    expect(scanDevice).toContain('ScanActivity');
    expect(scanDevice).not.toContain('getString');
    expect(plugin).not.toContain('scanDevice needs the device');
  });

  it('asks the person before it signs, renames, or sends the master key, and compares the match code itself', () => {
    expect(/fun signSession[\s\S]*?approve\(words, ticket\)/.test(plugin)).toBe(true);
    expect(/fun rename[\s\S]*?approve\(PromptText\.rename/.test(plugin)).toBe(true);
    expect(plugin).toMatch(/strongBiometricOnly = true/);
    expect(plugin).toMatch(/MatchCode\.matches\(claim\.code, typed\)/);
  });
});
