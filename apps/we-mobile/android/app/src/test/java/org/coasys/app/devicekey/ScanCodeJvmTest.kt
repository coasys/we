package org.coasys.app.devicekey

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which QR codes the scanner hands back for a step. */
class ScanCodeJvmTest {
  @Test
  fun aCodeOrALinkCarryingItAfterItsHashIsTheStepsCode() {
    assertTrue(carries("coasys:device:1:abc", "coasys:device:1:"))
    assertTrue(carries("coasys:offer:1:abc", "coasys:offer:1:"))
    assertTrue(carries("https://id.coasys.org/o#coasys:offer:1:abc", "coasys:offer:1:"))
  }

  @Test
  fun anotherStepsCodeOrAnyOtherTextIsNot() {
    assertFalse(carries("coasys:offer:1:abc", "coasys:device:1:"))
    assertFalse(carries("https://id.coasys.org/o#coasys:offer:1:abc", "coasys:device:1:"))
    assertFalse(carries("https://example.com/coasys:offer:1:abc", "coasys:offer:1:"))
    assertFalse(carries("WIFI:S:home;;", "coasys:offer:1:"))
    assertFalse(carries("anything", ""))
  }
}
