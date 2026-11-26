package org.coasys.app.devicekey

import android.graphics.Bitmap
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient

/**
 * Capacitor's WebViewClient, feeding [CallerDocument] from the callbacks' own `url` arguments.
 *
 * Capacitor's `WebViewListener` is not used: in 8.6.3 `BridgeWebViewClient.onPageFinished(view, url)`
 * drops `url` and hands a listener only the view, whose `url` is the history entry's address and
 * can be set by a same-document `pushState`. Every override calls `super` first, so Capacitor's own
 * behaviour (resetting the bridge, its listeners, the error page) is unchanged.
 *
 * Installed with `Bridge.setWebViewClient` after the bridge is built (`Bridge` installs its own
 * client at the end of its constructor, after plugins load): see [DeviceKeyPlugin.installPageGate].
 */
class CallerWebViewClient(bridge: Bridge, private val document: CallerDocument) : BridgeWebViewClient(bridge) {
  override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
    super.onPageStarted(view, url, favicon)
    document.started(url)
  }

  override fun onPageCommitVisible(view: WebView, url: String?) {
    super.onPageCommitVisible(view, url)
    document.committed(url)
  }

  override fun onPageFinished(view: WebView, url: String?) {
    super.onPageFinished(view, url)
    document.finished(url)
  }
}
