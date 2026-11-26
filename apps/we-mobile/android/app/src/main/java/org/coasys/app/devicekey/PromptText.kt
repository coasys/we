package org.coasys.app.devicekey

import java.net.URI

/**
 * The words of each confirmation, built from what is about to be done and nothing else: the title
 * names the action and whom it is for, so the person is told what their fingerprint authorises.
 * Names and addresses come from the page, so they are cut to a length that fits and stripped of
 * line breaks and other control characters before they are shown.
 */
object PromptText {
  /** A title and a description. */
  data class Words(val title: String, val description: String)

  private const val MAX_NAME = 40

  /** `text` as one short line a person can read: no control characters, cut with an ellipsis. */
  fun plain(text: String, max: Int = MAX_NAME): String {
    val line = text.filter { !it.isISOControl() }.trim()
    return if (line.length <= max) line else line.take(max - 1) + "…"
  }

  /** The longest host DNS allows; a longer one is no destination to sign for. */
  private const val MAX_HOST = 253

  /**
   * The origin a session is signed for, canonical and whole: `scheme://host` or `scheme://host:port`,
   * the scheme and host lower-case, an internationalised host in its ASCII (punycode) form so a
   * look-alike shows as what it is. Null — the call is refused, never shortened — if it is no http(s)
   * address, names a user, or its host is empty, unconvertible or longer than [MAX_HOST].
   */
  fun originOf(url: String): String? {
    val uri = try {
      URI(url.trim())
    } catch (_: Exception) {
      return null
    }
    val scheme = uri.scheme?.lowercase()
    // java.net.URI reads a non-ASCII host as a registry authority and gives no host: split it by hand.
    var port = uri.port
    var raw = uri.host
    if (raw == null) {
      val authority = uri.authority ?: return null
      val m = Regex("^([^@:/\\[\\]]+)(?::(\\d{1,5}))?$").matchEntire(authority) ?: return null
      raw = m.groupValues[1]
      port = m.groupValues[2].takeIf { it.isNotEmpty() }?.toInt() ?: -1
    }
    if ((scheme != "https" && scheme != "http") || raw.isNullOrEmpty() || uri.rawUserInfo != null) return null
    val host = if (raw.startsWith("[")) {
      raw.lowercase()
    } else {
      try {
        java.net.IDN.toASCII(raw, java.net.IDN.USE_STD3_ASCII_RULES).lowercase()
      } catch (_: IllegalArgumentException) {
        return null
      }
    }
    if (host.isEmpty() || host.length > MAX_HOST || host.any { it.isISOControl() || it.isWhitespace() }) return null
    return if (port == -1) "$scheme://$host" else "$scheme://$host:$port"
  }

  /**
   * The sign-in prompt. The origin is shown in full, never cut by [plain]: it is the destination the
   * person authorises, and a cut would show only a trusted-looking prefix of a longer host. It is in
   * the title and again in the description, which wraps.
   */
  fun signIn(renew: Boolean, origin: String): Words =
    if (renew) {
      Words("Stay signed in to $origin", "This phone will renew its sign-in at $origin with its device key.")
    } else {
      Words("Sign in to $origin", "This phone will sign in at $origin with its device key.")
    }

  fun sendMaster(device: String): Words =
    Words(
      "Send your master key to ${plain(device)}",
      "That device will be able to act as you. Only continue if you trust it.",
    )

  fun rename(current: String, name: String): Words =
    Words("Rename ${plain(current)} to ${plain(name)}", "Only continue if you asked for this.")
}
