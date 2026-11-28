package org.coasys.app.devicekey

/**
 * Whether plugin calls reach the plugin through Capacitor's web-message listener, the one transport
 * that tells the plugin which frame a call came from.
 *
 * Capacitor 8.6.3's `MessageHandler` installs `addJavascriptInterface(.., "androidBridge")` instead
 * (every frame of the page may then call `postMessage`, and the plugin cannot tell which) in three
 * cases: the configuration asks for the legacy bridge; the WebView does not support
 * `WEB_MESSAGE_LISTENER`; or `addWebMessageListener` throws. It records none of this: the first is
 * read from the config, the second from `WebViewFeature`, and the third by [TransportWebView] seeing
 * the fallback installed. A call is allowed only when none of the three happened, and anything not
 * known is not allowed.
 */
object BridgeTransport {
  /** `featureSupported` null (not asked) or `interfaceInstalled` null (not our WebView) is a refusal. */
  fun isWebMessageListener(legacyConfigured: Boolean?, featureSupported: Boolean?, interfaceInstalled: Boolean?): Boolean =
    legacyConfigured == false && featureSupported == true && interfaceInstalled == false
}
