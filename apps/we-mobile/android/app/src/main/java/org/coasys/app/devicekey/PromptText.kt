package org.coasys.app.devicekey

import java.util.Locale

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
  /**
     * The origin a session is signed for: the same string Rust signs (`session::origin_of` in
     * `crates/phone-custody`), by the same steps, so what the person reads is what is signed.
     * `scheme://host` or `scheme://host:port`: `ws`/`wss` as `http`/`https`, the scheme and host
     * lower-case, the scheme's default port left out. Null, and the call refused, never shortened, if
     * it is no http(s)/ws(s) address, names a user, has a non-ASCII host (an internationalised name
     * must be given in its punycode `xn--` form: converting it here would show one name and sign
     * another), a host that is not a plain name or address, a port that is not 1 to 65535 without a
     * leading zero, or a host longer than [MAX_HOST]. `crates/phone-custody/tests/origin_vectors.json`
     * holds the two implementations to the same answers.
     */
    fun originOf(url: String): String? {
      val trimmed = url.trim()
      val at = trimmed.indexOf("://")
      if (at < 0) return null
      val (scheme, defaultPort) = when (trimmed.substring(0, at).lowercase(Locale.ROOT)) {
        "http", "ws" -> "http" to "80"
        "https", "wss" -> "https" to "443"
        else -> return null
      }
      val rest = trimmed.substring(at + 3)
      val authority = rest.split('/', '?', '#').first()
      if (authority.isEmpty() || authority.contains('@')) return null
      if (authority.any { it.code > 0x7f }) return null
      val lower = authority.lowercase(Locale.ROOT)
      val colon = lower.lastIndexOf(':')
      val hasPort = colon >= 0 && !lower.substring(colon).contains(']')
      val host = if (hasPort) lower.substring(0, colon) else lower
      val port = if (hasPort) lower.substring(colon + 1) else null
      if (host.isEmpty() || host.length > MAX_HOST || !isPlainHost(host)) return null
      if (port != null && !isCanonicalPort(port)) return null
      return if (port != null && port != defaultPort) "$scheme://$host:$port" else "$scheme://$host"
    }

    /** `a-z`, digits, `.`, `-`, `_`, or a bracketed IPv6 address; the host is already lower-case. */
    private fun isPlainHost(host: String): Boolean =
      if (host.startsWith("[")) {
        host.endsWith("]") && host.length > 2 &&
          host.substring(1, host.length - 1).all { it in '0'..'9' || it in 'a'..'f' || it == ':' || it == '.' }
      } else {
        host.all { it in 'a'..'z' || it in '0'..'9' || it == '.' || it == '-' || it == '_' }
      }

    private fun isCanonicalPort(port: String): Boolean =
      port.isNotEmpty() && port.length <= 5 && port[0] != '0' && port.all { it in '0'..'9' } && port.toInt() <= 65535

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
