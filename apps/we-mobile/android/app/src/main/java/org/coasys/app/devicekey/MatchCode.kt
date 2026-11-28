package org.coasys.app.devicekey

import java.security.MessageDigest

/**
 * The match code of a link, compared here and never by the page: the plugin keeps the code it
 * derived from the claim, the person types the one the other device shows into a native prompt, and
 * only this decides whether they are the same. A script on the page can show or hide the code, but
 * it cannot say that they matched.
 */
object MatchCode {
  /** Letters and digits only, upper case: spaces, dashes and case in what was typed do not matter. */
  fun normalise(text: String): String = text.filter { it.isLetterOrDigit() }.uppercase()

  /** Whether `typed` is the code the plugin derived. An empty code never matches. */
  fun matches(derived: String, typed: String): Boolean {
    val a = normalise(derived).toByteArray(Charsets.UTF_8)
    val b = normalise(typed).toByteArray(Charsets.UTF_8)
    if (a.isEmpty() || b.isEmpty()) return false
    return MessageDigest.isEqual(a, b)
  }
}
