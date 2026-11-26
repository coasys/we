package org.coasys.app.devicekey

import java.net.URI

/**
 * Which page of the WebView a plugin call comes from.
 *
 * Every page WE shows is the same origin, and WE runs installed modules and cartridges in it, so
 * "a call from this app" says nothing about who made it. The calls that sign, link a device, send
 * the master key, rename or revoke are the identity page's alone: a page of its own that runs no
 * template, module or store code (`apps/we-mobile/src/identity`). The plugin reads the WebView's
 * address natively and refuses the rest; a script cannot name its own page.
 *
 * Pure functions on the address, so the rule is tested without a device.
 */
object CallerPage {
  /** The identity page's path: `IDENTITY_PAGE` in `apps/we-web/src/platform/phoneCustody.ts`. */
  const val IDENTITY_PATH = "/mobile/identity.html"

  /** The host Capacitor serves the app under, over https (`server.androidScheme`). */
  private const val APP_HOST = "localhost"

  /** An address of the app's own origin: https, `localhost`, the default port, no credentials. */
  fun isApp(url: String?): Boolean = parse(url) != null

  /** The identity page, exactly: its path, with any query or fragment. */
  fun isIdentityPage(url: String?): Boolean = parse(url)?.rawPath == IDENTITY_PATH

  private fun parse(url: String?): URI? {
    if (url.isNullOrEmpty()) return null
    val uri = try {
      URI(url)
    } catch (_: Exception) {
      return null
    }
    val own = uri.scheme == "https" &&
      uri.host == APP_HOST &&
      uri.port == -1 &&
      uri.rawUserInfo == null &&
      uri.rawAuthority == APP_HOST
    return if (own) uri else null
  }
}
