package org.coasys.app.devicekey

/**
 * Which DOCUMENT is loaded in the WebView, as opposed to which address its history shows.
 *
 * `WebView.url` is the address of the current history entry, and a script on any page of the app's
 * origin can change that with `history.pushState` or `replaceState` without loading anything. So a
 * gate that reads it admits a main-page script that has pushed the identity page's path. This class
 * reads no WebView at all: it is fed by the `url` argument of the real navigation callbacks
 * (`WebViewClient.onPageStarted`, `onPageCommitVisible` and `onPageFinished`, in
 * [CallerWebViewClient]), which Android raises for a navigation that creates a new document and not
 * for pushState, replaceState or a fragment change.
 *
 * A load has three steps, and the document is *loading* until the last two have both come for the
 * address the first named. [started]: the navigation began. [committed]: the new document's content
 * is what the WebView draws (`onPageCommitVisible`: a navigation that is stopped before it commits
 * never raises it). [finished]: the load ended (`onPageFinished`, which Android raises for a stopped
 * navigation too, so it proves nothing alone). While loading the old document may still be running and
 * posting calls (a page that sets `location` keeps running until it unloads), so a call for the
 * identity page is refused. Only a load that started, committed and finished, all for one address,
 * admits the identity page, and only once the plugin's call queue has drained past the commit
 * ([drained]): every call the old document posted was queued before the commit callback ran, so a
 * barrier posted to the same queue at the commit comes after all of them, and they are refused.
 * Every start bumps a generation; a call is admitted against the document loaded now and carries
 * the [Ticket] it was admitted under, and the plugin asks [holds] after each wait it controls (a
 * prompt, the camera, a link step), which a start in between, even a reload of the same page,
 * voids. A native operation already running is not stopped by it; only its result is refused. A
 * back or forward to another document is a start like any other.
 *
 * Pure and synchronised, so the rule is tested on the JVM.
 */
class CallerDocument {
  /** The document a call was admitted against. */
  class Ticket internal constructor(internal val generation: Long)

  private var generation = 0L
  private var document: String? = null
  private var committed = false
  private var finished = false

  /** The last generation whose commit the plugin's call queue has drained past. */
  private var drainedGeneration = -1L

  /** A real document load began; [url] is the address the navigation is for. */
  @Synchronized
  fun started(url: String?) {
    generation += 1
    document = url
    committed = false
    finished = false
  }

  /**
   * The new document's content committed, with the WebView at [url]. It counts only if it is the
   * document [started] named; a commit for anything else leaves the document loading. Returns the
   * generation that committed, for the barrier the caller posts to the plugin's call queue, which
   * calls [drained] with it; null when the commit did not count.
   */
  @Synchronized
  fun committed(url: String?): Long? {
    if (url == null || url != document) return null
    committed = true
    return generation
  }

  /** The plugin's call queue ran the barrier posted at [generation]'s commit: no call queued before it is left. */
  @Synchronized
  fun drained(generation: Long) {
    if (generation > drainedGeneration) drainedGeneration = generation
  }

  /**
   * The load that began last finished, at [url]. It counts only if it is the document [started]
   * named: a finish that arrives for anything else (an earlier page's, a redirect) leaves the
   * document loading, so it admits nothing.
   */
  @Synchronized
  fun finished(url: String?) {
    if (url != null && url == document) finished = true
  }

  /**
   * A ticket if the loaded document may make a call that needs the identity page (or any page of the
   * app); else null. The identity page is admitted only once its load has committed and finished,
   * and the call queue has drained past the commit;
   * any page of the app is admitted while loading too, because WE signs in while it boots, and every
   * such page is already the app's own origin.
   */
  @Synchronized
  fun admit(identityOnly: Boolean): Ticket? {
    val loaded = committed && finished && drainedGeneration == generation
    val allowed = if (identityOnly) loaded && CallerPage.isIdentityPage(document) else CallerPage.isApp(document)
    return if (allowed) Ticket(generation) else null
  }

  /** True while the document the ticket was issued for is still the one loaded. */
  @Synchronized
  fun holds(ticket: Ticket): Boolean = ticket.generation == generation && document != null
}
