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
