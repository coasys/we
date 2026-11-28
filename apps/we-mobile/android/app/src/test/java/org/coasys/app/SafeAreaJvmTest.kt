package org.coasys.app

import org.coasys.app.SafeArea.Edges
import org.junit.Assert.assertEquals
import org.junit.Test

/** How far the WebView's parent is padded from each edge. */
class SafeAreaJvmTest {
  @Test
  fun theBarsAndTheCutoutAreKeptClearOnEveryEdge() {
    // A status bar, a three-button navigation bar, and a cutout down the left in landscape.
    assertEquals(Edges(88, 63, 0, 126), SafeArea.padding(Edges(88, 63, 0, 126), ime = 0))
  }

  @Test
  fun anOpenKeyboardRisesOverTheNavigationBarRatherThanStackingOnIt() {
    assertEquals(Edges(0, 63, 0, 900), SafeArea.padding(Edges(0, 63, 0, 126), ime = 900))
  }

  @Test
  fun aClosedKeyboardLeavesTheNavigationBarsHeight() {
    assertEquals(Edges(0, 63, 0, 126), SafeArea.padding(Edges(0, 63, 0, 126), ime = 0))
    // Gesture navigation: a thin bar, still kept clear.
    assertEquals(Edges(0, 63, 0, 42), SafeArea.padding(Edges(0, 63, 0, 42), ime = 0))
  }

  @Test
  fun noBarsIsNoPadding() {
    assertEquals(Edges(0, 0, 0, 0), SafeArea.padding(Edges(0, 0, 0, 0), ime = 0))
  }
}
