package org.coasys.app.devicekey

import android.content.Context
import android.util.AttributeSet
import com.getcapacitor.CapacitorWebView

/**
 * Capacitor's WebView, remembering whether the `androidBridge` name was given to
 * `addJavascriptInterface`. Capacitor does that only as its fallback when the web-message listener
 * is unavailable or fails to install (`MessageHandler`, 8.6.3), and keeps no record of it; this view
 * is the record, with no reflection on Capacitor's private state. It replaces `CapacitorWebView` in
 * `res/layout/capacitor_bridge_layout_main.xml` (the same layout otherwise: a contract test holds
 * them together). See [BridgeTransport].
 */
class TransportWebView(context: Context, attrs: AttributeSet?) : CapacitorWebView(context, attrs) {
  @Volatile
  var bridgeInterfaceInstalled = false
    private set

  override fun addJavascriptInterface(`object`: Any, name: String) {
    if (name == BRIDGE_NAME) bridgeInterfaceInstalled = true
    super.addJavascriptInterface(`object`, name)
  }

  companion object {
    /** The name Capacitor's `MessageHandler` gives its transport, either way. */
    const val BRIDGE_NAME = "androidBridge"
  }
}
