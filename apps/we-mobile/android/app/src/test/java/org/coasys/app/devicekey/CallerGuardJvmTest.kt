package org.coasys.app.devicekey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which page may call, how a match code is compared, and what each prompt says. */
class CallerGuardJvmTest {
  @Test
  fun theIdentityPageIsTheOneAddressWithItsPath() {
    assertTrue(CallerPage.isIdentityPage("https://localhost/mobile/identity.html"))
    assertTrue(CallerPage.isIdentityPage("https://localhost/mobile/identity.html?change=%7B%7D&back=%2F#x"))
  }

  @Test
  fun anotherPageOfTheAppIsNotTheIdentityPage() {
    assertFalse(CallerPage.isIdentityPage("https://localhost/"))
    assertFalse(CallerPage.isIdentityPage("https://localhost/mobile/identity.html/"))
    assertFalse(CallerPage.isIdentityPage("https://localhost/mobile/identity.html/../x"))
    assertFalse(CallerPage.isIdentityPage("https://localhost/x/mobile/identity.html"))
    assertFalse(CallerPage.isIdentityPage("https://localhost/mobile/%69dentity.html"))
    assertFalse(CallerPage.isIdentityPage("https://localhost/?u=/mobile/identity.html"))
  }

  @Test
  fun anotherOriginIsNeitherEvenWithTheRightPath() {
    for (url in listOf(
      "https://evil.example/mobile/identity.html",
      "https://localhost.evil.example/mobile/identity.html",
      "https://localhost@evil.example/mobile/identity.html",
      "https://evil.example@localhost/mobile/identity.html",
      "https://localhost:8443/mobile/identity.html",
      "http://localhost/mobile/identity.html",
      "file:///mobile/identity.html",
      "javascript:alert(1)",
      "about:blank",
      "",
    )) {
      assertFalse(url, CallerPage.isIdentityPage(url))
      assertFalse(url, CallerPage.isApp(url))
    }
    assertFalse(CallerPage.isApp(null))
    assertFalse(CallerPage.isIdentityPage(null))
    assertFalse(CallerPage.isApp("not a url at all"))
  }

  @Test
  fun anyPageOfTheAppsOwnOriginIsTheApp() {
    assertTrue(CallerPage.isApp("https://localhost/"))
    assertTrue(CallerPage.isApp("https://localhost/some/space?x=1#y"))
    assertTrue(CallerPage.isApp("https://localhost/mobile/identity.html"))
  }

  private val identity = "https://localhost/mobile/identity.html"
  private val main = "https://localhost/"

  /** A real load of [url], from its start to its finish. */
  private fun CallerDocument.load(url: String?) {
    started(url)
    finished(url)
  }

  @Test
  fun aRealLoadOfTheIdentityPageAdmitsAndNothingBeforeALoadDoes() {
    val doc = CallerDocument()
    assertNull(doc.admit(identityOnly = true))
    assertNull(doc.admit(identityOnly = false))
    doc.load(identity)
    assertTrue(doc.admit(identityOnly = true) != null)
    assertTrue(doc.admit(identityOnly = false) != null)
  }

  @Test
  fun pushStateToTheIdentityPathLeavesTheMainPageMain() {
    // The plugin only ever calls started() from a real document load. pushState/replaceState raise no
    // load, so the loaded document stays the main page whatever the history address says.
    val doc = CallerDocument()
    doc.load(main)
    assertNull(doc.admit(identityOnly = true))
    assertTrue(doc.admit(identityOnly = false) != null)
  }

  @Test
  fun aCallReceivedWhileTheIdentityPageIsLoadingIsRefused() {
    // The main page set `location`: it keeps running and posting until it unloads.
    val doc = CallerDocument()
    doc.load(main)
    doc.started(identity)
    assertNull(doc.admit(identityOnly = true))
    // The app's other pages are open to it anyway (WE signs in while booting).
    assertTrue(doc.admit(identityOnly = false) != null)
    doc.finished(identity)
    assertTrue(doc.admit(identityOnly = true) != null)
  }

  @Test
  fun aFinishThatIsNotTheLoadingDocumentAdmitsNothing() {
    val doc = CallerDocument()
    doc.started(identity)
    doc.finished(main) // an earlier page's finish, or a redirect
    assertNull(doc.admit(identityOnly = true))
    doc.finished(null)
    assertNull(doc.admit(identityOnly = true))
    doc.finished(identity)
    assertTrue(doc.admit(identityOnly = true) != null)
  }

  @Test
  fun aCallStampedBeforeTheFlipIsRefusedAfterIt() {
    val doc = CallerDocument()
    doc.load(main)
    val old = doc.admit(identityOnly = false)!!
    doc.started(identity)
    assertFalse(doc.holds(old))
    doc.finished(identity)
    assertFalse(doc.holds(old))
    assertTrue(doc.holds(doc.admit(identityOnly = true)!!))
  }

  @Test
  fun aNewLoadVoidsAPendingCall() {
    val doc = CallerDocument()
    doc.load(identity)
    val ticket = doc.admit(identityOnly = true)!!
    assertTrue(doc.holds(ticket))
    doc.load(identity) // a reload of the same page is a new document
    assertFalse(doc.holds(ticket))
    doc.load(main)
    assertFalse(doc.holds(ticket))
  }

  @Test
  fun reloadingTheMainPageAfterTheIdentityPageRefuses() {
    val doc = CallerDocument()
    doc.load(identity)
    val ticket = doc.admit(identityOnly = true)!!
    doc.load(main)
    assertNull(doc.admit(identityOnly = true))
    assertFalse(doc.holds(ticket))
    doc.load(null)
    assertNull(doc.admit(identityOnly = false))
  }

  @Test
  fun aMatchCodeMatchesWhateverTheSpacingAndCase() {
    assertTrue(MatchCode.matches("Q2M R7K", "q2m r7k"))
    assertTrue(MatchCode.matches("Q2M R7K", "Q2MR7K"))
    assertTrue(MatchCode.matches("Q2M R7K", " q2m-r7k "))
  }

  @Test
  fun aDifferentOrEmptyCodeNeverMatches() {
    assertFalse(MatchCode.matches("Q2M R7K", "Q2M R7L"))
    assertFalse(MatchCode.matches("Q2M R7K", "Q2M"))
    assertFalse(MatchCode.matches("Q2M R7K", "Q2M R7K 1"))
    assertFalse(MatchCode.matches("Q2M R7K", ""))
    assertFalse(MatchCode.matches("Q2M R7K", "   "))
    assertFalse(MatchCode.matches("", ""))
    assertFalse(MatchCode.matches("", "Q2M R7K"))
  }

  @Test
  fun aSigningPromptNamesTheOriginItSignsFor() {
    assertEquals("https://host.example", PromptText.originOf("https://host.example/graphql?x=1"))
    assertEquals("http://10.0.2.2:12000", PromptText.originOf("http://10.0.2.2:12000/"))
    assertNull(PromptText.originOf("file:///etc/passwd"))
    assertNull(PromptText.originOf("host.example"))
    assertEquals("Sign in to https://host.example", PromptText.signIn(false, "https://host.example").title)
    assertEquals("Stay signed in to https://host.example", PromptText.signIn(true, "https://host.example").title)
  }

  @Test
  fun aLongDestinationIsShownWholeNeverCut() {
    val a = "https://trusted.example." + "a".repeat(60) + ".attacker.example"
    val b = "https://trusted.example." + "a".repeat(60) + ".other.example"
    assertEquals(a.take(59), b.take(59))
    val oa = PromptText.originOf(a)!!
    val ob = PromptText.originOf(b)!!
    assertEquals(a, oa)
    assertTrue(PromptText.signIn(false, oa).title.endsWith(".attacker.example"))
    assertTrue(PromptText.signIn(true, ob).description.contains(".other.example"))
    assertTrue(PromptText.signIn(false, oa).title != PromptText.signIn(false, ob).title)
  }

  @Test
  fun anOriginIsCanonicalOrRefused() {
    assertEquals("https://host.example:8443", PromptText.originOf("HTTPS://Host.Example:8443/x"))
    assertEquals("https://xn--bcher-kva.example", PromptText.originOf("https://bücher.example/"))
    assertNull(PromptText.originOf("https://user@host.example/"))
    val longLabel = "a".repeat(63)
    val tooLong = "https://" + listOf(longLabel, longLabel, longLabel, longLabel, "example").joinToString(".") + "/"
    assertNull(PromptText.originOf(tooLong))
  }

  @Test
  fun theOtherPromptsNameTheDeviceAndTheNewName() {
    assertEquals("Send your master key to Work laptop", PromptText.sendMaster("Work laptop").title)
    assertEquals("Rename Phone to Office", PromptText.rename("Phone", "Office").title)
  }

  @Test
  fun aNameFromThePageIsOneShortLine() {
    assertEquals("abc", PromptText.plain("a\nb\u0007c"))
    val long = PromptText.plain("x".repeat(200))
    assertEquals(40, long.length)
    assertTrue(long.endsWith("…"))
    assertFalse(PromptText.sendMaster("Laptop\nSend it everything").title.contains('\n'))
  }
}
