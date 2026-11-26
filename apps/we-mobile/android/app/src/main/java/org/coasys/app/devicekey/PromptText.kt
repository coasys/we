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

  /** The origin a session is signed for, as `https://host` or `https://host:port`; null if it is no http(s) address. */
  fun originOf(url: String): String? {
    val uri = try {
      URI(url.trim())
    } catch (_: Exception) {
      return null
    }
    val scheme = uri.scheme?.lowercase()
    val host = uri.host
    if ((scheme != "https" && scheme != "http") || host.isNullOrEmpty()) return null
    return if (uri.port == -1) "$scheme://$host" else "$scheme://$host:${uri.port}"
  }

  fun signIn(renew: Boolean, origin: String): Words =
    if (renew) {
      Words("Stay signed in to ${plain(origin, 60)}", "This phone will renew its sign-in there with its device key.")
    } else {
      Words("Sign in to ${plain(origin, 60)}", "This phone will sign in there with its device key.")
    }

  fun sendMaster(device: String): Words =
    Words(
      "Send your master key to ${plain(device)}",
      "That device will be able to act as you. Only continue if you trust it.",
    )

  fun rename(current: String, name: String): Words =
    Words("Rename ${plain(current)} to ${plain(name)}", "Only continue if you asked for this.")
}
