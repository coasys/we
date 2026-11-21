package org.coasys.app

import android.view.View
import android.view.Window
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Keeps the WebView between the system bars, the display cutout and the keyboard, on every Android
 * version and WebView this app runs on.
 *
 * WE lays itself out in window coordinates (its chrome, its panels and the call bar are
 * `position: fixed` against the viewport) and its page does not declare `viewport-fit=cover`, so
 * it needs a viewport that nothing system-drawn covers. Capacitor's SystemBars plugin gives that on
 * only one of its branches: it pads the decor view, or passes the insets through to the page,
 * depending on the WebView's major version (140, and 144 for the keyboard) and on the last
 * `meta[name=viewport]` it read after a page committed. This app's own pages (identity and error)
 * declare `viewport-fit=cover` and WE's does not, so which branch WE's page got could depend on the
 * page before it. Its insets handling is turned off in capacitor.config.ts
 * (`SystemBars.insetsHandling: 'disable'`), and this is the one place that decides instead.
 *
 * The WebView's parent is padded by the bars and the cutout, and at the bottom by the keyboard when
 * it is taller than the navigation bar. The WebView is handed insets with those parts zeroed, so a
 * page that asks for `env(safe-area-inset-*)` does not pad a second time.
 */
object SafeArea {
  /** Pixels of padding on each edge. */
  data class Edges(val left: Int, val top: Int, val right: Int, val bottom: Int)

  /**
   * The padding that keeps content clear of [bars] (the system bars and the display cutout,
   * together) and of a keyboard [ime] pixels tall. A hidden keyboard is zero pixels tall, and a
   * visible one rises over the navigation bar rather than stacking on it: the bottom is the larger
   * of the two.
   */
  fun padding(bars: Edges, ime: Int): Edges =
    Edges(
      left = bars.left.coerceAtLeast(0),
      top = bars.top.coerceAtLeast(0),
      right = bars.right.coerceAtLeast(0),
      bottom = maxOf(bars.bottom, ime, 0),
    )

  /** What [install] pads by: the bars and the cutout, as one set of edges. */
  private val PADDED = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()

  /**
   * Lay [window] out edge to edge and pad [container] (the WebView's parent) by [padding] on every
   * insets change. Call once, after the bridge has made its WebView.
   */
  fun install(window: Window, container: View) {
    // What Android 15 enforces, on 11 to 14 as well: every inset reaches the listener below, rather
    // than the decor view fitting some of them first.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
      val bars = insets.getInsets(PADDED)
      val pad =
        padding(
          Edges(bars.left, bars.top, bars.right, bars.bottom),
          insets.getInsets(WindowInsetsCompat.Type.ime()).bottom,
        )
      view.setPadding(pad.left, pad.top, pad.right, pad.bottom)
      // Zeroed rather than CONSUMED: a consumed set stops the WebView recomputing its safe area at
      // all (https://issues.chromium.org/issues/461332423, as Capacitor's SystemBars notes).
      WindowInsetsCompat.Builder(insets)
        .setInsets(PADDED, Insets.NONE)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(container)
  }
}
