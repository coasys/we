package org.coasys.app.devicekey

import java.io.File
import java.nio.file.Files
import javax.crypto.SecretKey
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import uniffi.we_phone_custody.DeviceKeys
import uniffi.we_phone_custody.PhoneIdentity
import uniffi.we_phone_custody.PhoneInput
import uniffi.we_phone_custody.PhoneKeyException
import uniffi.we_phone_custody.PhoneScreen
import uniffi.we_phone_custody.RestoreDeviceView
import uniffi.we_phone_custody.StoreConfig

/**
 * The identity steps' Kotlin half on the JVM: the JSON the page sends and reads
 * ([IdentityStepsJson]), and the real `we_phone_custody` library's make flow driven through the
 * same uniffi handle the plugin holds, against a store that does not answer. The flows themselves
 * (make, restore, replace, a pending publish) run against a real identity store in
 * `crates/phone-custody/tests/store.rs`.
 */
class IdentityStepsJvmTest {
  private lateinit var dir: File
  private lateinit var key: SecretKey
  private lateinit var server: PhoneIdentityJvmTest.HttpServer
  private val paths = java.util.Collections.synchronizedList(mutableListOf<String>())

  /** Whether the store reads its key index (404: no identity has this key); every other call is 503. */
  @Volatile private var indexUp = true

  @Before
  fun setUp() {
    dir = Files.createTempDirectory("identity-steps").toFile()
    key = DeviceKeysJvmTest.aesKey()
    server = PhoneIdentityJvmTest.HttpServer { got ->
      paths.add("${got.method} ${got.path}")
      if (indexUp && got.method == "GET" && got.path.startsWith("/v1/keys/")) {
        Triple(404, emptyMap(), "{\"error\":\"not-found\"}".toByteArray())
      } else {
        Triple(503, emptyMap(), "{\"error\":\"busy\"}".toByteArray())
      }
    }
  }

  @After
  fun tearDown() {
    server.stop()
    dir.deleteRecursively()
  }

  private fun phone(protection: String = "tee", folder: String = "phone"): PhoneIdentity {
    val keys = DeviceKeys.open(File(dir, folder).absolutePath, AesGcmSealer { key })
    keys.create()
    // An Ed25519 multikey for the store to sign with: the store here never signs, so whose key it
    // is does not matter, only that the phone trusts one.
    val storeKey = DeviceKeys.open(File(dir, "$folder-store").absolutePath, AesGcmSealer { key }).create().sign
    return PhoneIdentity(
      keys,
      StoreHttp.Transport,
      PhoneIdentityJvmTest.SoftMaster(protection),
      StoreConfig("http://127.0.0.1:${server.port}", listOf(storeKey)),
    )
  }

  @Test
  fun everyInputThePageSendsBecomesTheFlowsInput() {
    fun input(json: String) = IdentityStepsJson.inputOf(JSONObject(json))

    assertEquals(PhoneInput.WordsWritten, input("""{"input":"words-written"}"""))
    assertEquals(
      PhoneInput.ConfirmWords("apple", "zoo"),
      input("""{"input":"confirm-words","first":"apple","second":"zoo"}"""),
    )
    assertEquals(PhoneInput.NameDevice(null), input("""{"input":"name-device"}"""))
    assertEquals(PhoneInput.NameDevice("Pixel"), input("""{"input":"name-device","name":"Pixel"}"""))
    assertEquals(PhoneInput.TwelveWords("a b c"), input("""{"input":"twelve-words","words":"a b c"}"""))
    assertEquals(
      PhoneInput.LockOut(listOf("d1", "d3"), "New phone"),
      input("""{"input":"lock-out","keyIds":["d1","d3"],"name":"New phone"}"""),
    )
    assertEquals(PhoneInput.LockOut(emptyList(), null), input("""{"input":"lock-out"}"""))
    assertEquals(PhoneInput.TryAgain, input("""{"input":"try-again"}"""))
  }

  @Test
  fun anInputThatIsNoneOrLacksItsWordsIsRefusedBeforeTheFlowSeesIt() {
    fun refused(json: String?) = assertThrows(IllegalArgumentException::class.java) {
      IdentityStepsJson.inputOf(json?.let(::JSONObject))
    }.message!!

    assertEquals("the step needs its input", refused(null))
    assertEquals("the step needs its input", refused("{}"))
    assertTrue(refused("""{"input":"paste"}""").contains("\"paste\" is not an input"))
    assertEquals("the input needs \"second\"", refused("""{"input":"confirm-words","first":"a"}"""))
    assertEquals("the input needs \"words\"", refused("""{"input":"twelve-words","words":null}"""))
  }

  @Test
  fun everyScreenReadsAsThePageExpects() {
    val words = (1..12).map { "w$it" }
    val shown = IdentityStepsJson.screenJson(PhoneScreen.ShowWords(words))
    assertEquals("show-words", shown.getString("screen"))
    assertEquals(12, shown.getJSONArray("words").length())

    val confirm = IdentityStepsJson.screenJson(PhoneScreen.ConfirmWords(listOf(3u, 9u), null))
    assertEquals("confirm-words", confirm.getString("screen"))
    assertEquals(9, confirm.getJSONArray("positions").getInt(1))
    assertTrue(confirm.isNull("error"))

    assertEquals("name-device", IdentityStepsJson.screenJson(PhoneScreen.NameDevice).getString("screen"))

    val enter = IdentityStepsJson.screenJson(PhoneScreen.EnterWords("restore", "not these", 4u))
    assertEquals("restore", enter.getString("purpose"))
    assertEquals(4, enter.getInt("position"))

    val devices = IdentityStepsJson.screenJson(
      PhoneScreen.RestoreDevices(
        "did:webvh:x",
        listOf(RestoreDeviceView("d1", "Laptop", "desktop-app", true), RestoreDeviceView("d2", null, null, false)),
        null,
      ),
    )
    assertEquals("restore-devices", devices.getString("screen"))
    val first = devices.getJSONArray("devices").getJSONObject(0)
    assertEquals("d1", first.getString("keyId"))
    assertTrue(first.getBoolean("lockOut"))
    assertTrue(devices.getJSONArray("devices").getJSONObject(1).isNull("name"))

    val ready = IdentityStepsJson.screenJson(PhoneScreen.IdentityReady("did:webvh:x", "d1", null))
    assertEquals("identity-ready", ready.getString("screen"))
    assertEquals("d1", ready.getString("keyId"))

    val stopped = IdentityStepsJson.screenJson(PhoneScreen.MakeStopped(null, "offline", true))
    assertEquals("make-stopped", stopped.getString("screen"))
    assertTrue(stopped.getBoolean("pending"))
    assertTrue(stopped.isNull("did"))

    val restored = IdentityStepsJson.screenJson(PhoneScreen.Restored("did:webvh:x", "Phone", "d4", listOf("d1"), null))
    assertEquals("d1", restored.getJSONArray("revoked").getString(0))

    val notLinked = IdentityStepsJson.screenJson(PhoneScreen.RestoreNotLinked("did:webvh:x", listOf("d1"), "offline"))
    assertEquals("restore-not-linked", notLinked.getString("screen"))

    val replaced = IdentityStepsJson.screenJson(PhoneScreen.MasterReplaced(2u, emptyList(), "sent"))
    assertEquals(2, replaced.getInt("index"))
    assertEquals("sent", replaced.getString("note"))

    val notKept = IdentityStepsJson.screenJson(PhoneScreen.MasterNotKept(2u, emptyList(), "the prompt", null))
    assertEquals("master-not-kept", notKept.getString("screen"))
  }

  /**
   * A make through the handle the plugin holds: the words shown, a wrong word asked again, an
   * input for another screen refused with the flow left where it was, the phone named, and a
   * store that does not answer the incept stopping the make with a screen, not an exception.
   * Cancelled, the flow is over.
   */
  @Test
  fun aMakeRunsThroughTheHandleAndAStoreThatIsDownStopsIt() {
    val identity = phone()
    val flow = identity.startMake(false)
    try {
      val shown = flow.next() as PhoneScreen.ShowWords
      assertEquals(12, shown.words.size)

      val asked = flow.step(PhoneInput.WordsWritten) as PhoneScreen.ConfirmWords
      assertEquals(2, asked.positions.size)
      assertNull(asked.error)
      val (a, b) = asked.positions.map { shown.words[it.toInt() - 1] }

      val wrongWord = if (b == "abandon") "ability" else "abandon"
      val again = flow.step(PhoneInput.ConfirmWords(a, wrongWord)) as PhoneScreen.ConfirmWords
      assertNotEquals(null, again.error)

      assertThrows(PhoneKeyException.WrongInput::class.java) {
        flow.step(PhoneInput.TwelveWords(shown.words.joinToString(" ")))
      }
      assertFalse(flow.ended())

      val again2 = flow.step(PhoneInput.ConfirmWords(a, b))
      assertEquals(PhoneScreen.NameDevice, again2)

      val stopped = flow.step(PhoneInput.NameDevice("Test phone")) as PhoneScreen.MakeStopped
      assertTrue(stopped.reason, stopped.reason.contains("Can't connect."))
      assertTrue("${stopped.reason} $paths", paths.any { it.startsWith("POST ") })
      // Master #0 and the incept are kept: the identity is pending, and published by a try again
      // or by finishPending once the store answers.
      assertTrue(stopped.pending)
      assertEquals(stopped.did, identity.pendingIdentity())

      flow.cancel()
      assertThrows(PhoneKeyException.Ended::class.java) { flow.step(PhoneInput.TryAgain) }
      assertTrue(flow.ended())
    } finally {
      flow.close()
    }
  }

  /**
   * A make reads the store's key index before it makes any word (a phone whose key is in an
   * identity already makes none): a store that does not answer refuses the first screen, and the
   * flow is over with nothing kept.
   */
  @Test
  fun aMakeWithTheStoreDownShowsNoWords() {
    indexUp = false
    val identity = phone()
    val flow = identity.startMake(false)
    try {
      val down = assertThrows(PhoneKeyException.Unavailable::class.java) { flow.next() }
      assertTrue(down.message!!, down.message!!.startsWith("Can't connect."))
      assertThrows(PhoneKeyException.Ended::class.java) { flow.step(PhoneInput.WordsWritten) }
      assertTrue(flow.ended())
      assertNull(identity.pendingIdentity())
    } finally {
      flow.close()
    }
  }

  @Test
  fun aStartIsRefusedBeforeAnyWordExists() {
    // A software Keystore, before the person agreed.
    val weak = assertThrows(PhoneKeyException.WeakProtection::class.java) {
      phone("software", "emulator").startMake(false)
    }
    assertTrue(weak.message!!, weak.message!!.contains("software"))

    // A replace needs an identity to replace the master key of.
    val identity = phone()
    assertThrows(PhoneKeyException.NoIdentity::class.java) { identity.startRotate(false) }
    assertNull(identity.pendingIdentity())
    assertNull(identity.finishPending())
  }
}
