package org.coasys.app.devicekey

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import uniffi.we_phone_custody.ClaimProgress
import uniffi.we_phone_custody.DeviceKeys
import uniffi.we_phone_custody.Header
import uniffi.we_phone_custody.MasterSealException
import uniffi.we_phone_custody.MasterSealer
import uniffi.we_phone_custody.PhoneIdentity
import uniffi.we_phone_custody.PhoneKeyException
import uniffi.we_phone_custody.StoreConfig
import uniffi.we_phone_custody.StoreRequest
import uniffi.we_phone_custody.TransportException

/**
 * Phase 2b's Kotlin half on the JVM: [StoreHttp.Transport], the `StoreTransport` the Rust side's
 * `ViaStore` speaks through, against a real HTTP server, and the real `we_phone_custody` library's
 * `PhoneIdentity` over it. The whole flows (take, ask, answer, link) run against a real identity
 * store in `crates/phone-custody/tests/store.rs`; here is what the app adds: the bytes, headers
 * and statuses the transport carries, and what a store that is down or failing becomes on the
 * way back up (`Unavailable`, which the page shows as offline, never as a refusal).
 */
class PhoneIdentityJvmTest {
  private lateinit var dir: File
  private lateinit var key: SecretKey
  private lateinit var server: HttpServer
  private lateinit var store: String
  private val seen = Collections.synchronizedList(mutableListOf<Seen>())
  @Volatile private var answer: (Seen) -> Triple<Int, Map<String, String>, ByteArray> =
    { Triple(503, emptyMap(), "{\"error\":\"busy\"}".toByteArray()) }

  class Seen(val method: String, val path: String, val headers: Map<String, String>, val body: ByteArray)

  @Before
  fun setUp() {
    dir = Files.createTempDirectory("phone-identity").toFile()
    key = DeviceKeysJvmTest.aesKey()
    server = HttpServer { got ->
      seen.add(got)
      answer(got)
    }
    store = "http://127.0.0.1:${server.port}"
  }

  @After
  fun tearDown() {
    server.stop()
    dir.deleteRecursively()
  }

  /**
   * An HTTP/1.1 server of one connection per request, enough for `HttpURLConnection`: android.jar
   * on the unit tests' classpath leaves out the JDK's own `com.sun.net.httpserver`.
   */
  class HttpServer(private val handle: (Seen) -> Triple<Int, Map<String, String>, ByteArray>) {
    private val socket = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    val port: Int = socket.localPort

    init {
      Thread {
        while (!socket.isClosed) {
          val client = try { socket.accept() } catch (_: Exception) { break }
          client.use { serve(it) }
        }
      }.apply { isDaemon = true }.start()
    }

    private fun serve(client: Socket) {
      val input = BufferedInputStream(client.getInputStream())
      val (method, path) = line(input).split(' ').let { it[0] to it[1] }
      val headers = generateSequence { line(input).takeIf { it.isNotEmpty() } }
        .map { it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim() }
        .toMap()
      val body = ByteArray(headers["content-length"]?.toInt() ?: 0)
      var read = 0
      while (read < body.size) {
        val n = input.read(body, read, body.size - read)
        if (n < 0) break
        read += n
      }
      val (status, replyHeaders, reply) = handle(Seen(method, path, headers, body))
      val head = StringBuilder("HTTP/1.1 $status X\r\n")
      replyHeaders.forEach { (k, v) -> head.append("$k: $v\r\n") }
      head.append("Content-Length: ${reply.size}\r\nConnection: close\r\n\r\n")
      client.getOutputStream().apply {
        write(head.toString().toByteArray())
        write(reply)
        flush()
      }
    }

    private fun line(input: BufferedInputStream): String {
      val out = ByteArrayOutputStream()
      while (true) {
        val b = input.read()
        if (b < 0 || b == '\n'.code) break
        if (b != '\r'.code) out.write(b)
      }
      return out.toString(Charsets.UTF_8.name())
    }

    fun stop() {
      socket.close()
    }
  }

  @Test
  fun theTransportCarriesMethodHeadersAndBytesBothWays() {
    answer = { Triple(201, mapOf("X-Store" to "yes"), byteArrayOf(0, 1, 2, -1)) }
    val reply = StoreHttp.Transport.send(
      StoreRequest(
        method = "PUT",
        url = "$store/v1/private/abc",
        headers = listOf(Header("X-Coasys-Request", "signed"), Header("Content-Type", "application/json")),
        body = "{\"a\":1}".toByteArray(),
      ),
    )
    assertEquals(201.toUShort(), reply.status)
    assertArrayEquals(byteArrayOf(0, 1, 2, -1), reply.body)
    assertTrue(reply.headers.any { it.name.equals("X-Store", true) && it.value == "yes" })
    val got = seen.single()
    assertEquals("PUT", got.method)
    assertEquals("/v1/private/abc", got.path)
    assertEquals("signed", got.headers["x-coasys-request"])
    assertEquals("{\"a\":1}", String(got.body))

    // A DELETE with no body, and an error status, are replies like any other.
    answer = { Triple(404, emptyMap(), "{\"error\":\"gone\"}".toByteArray()) }
    val gone = StoreHttp.Transport.send(StoreRequest("DELETE", "$store/v1/inbox/a/b/c", emptyList(), ByteArray(0)))
    assertEquals(404.toUShort(), gone.status)
    assertEquals("{\"error\":\"gone\"}", String(gone.body))
  }

  @Test
  fun aRequestWithNoAnswerOrAnOversizedOneIsATransportError() {
    val port = server.port
    server.stop()
    val down = assertThrows(TransportException.Failed::class.java) {
      StoreHttp.Transport.send(StoreRequest("GET", "http://127.0.0.1:$port/v1/logs/x", emptyList(), ByteArray(0)))
    }
    assertTrue(down.reason, down.reason.contains("ConnectException"))

    assertThrows(TransportException.Failed::class.java) {
      StoreHttp.Transport.send(StoreRequest("GET", "file:///etc/hostname", emptyList(), ByteArray(0)))
    }
    assertThrows(TransportException.Failed::class.java) {
      StoreHttp.Transport.send(StoreRequest("PATCH", "$store/v1/logs/x", emptyList(), ByteArray(0)))
    }
  }

  @Test
  fun aLogLargerThanTheLimitIsRefusedNotCut() {
    answer = { Triple(200, emptyMap(), ByteArray(StoreHttp.MAX_BODY + 1)) }
    val e = assertThrows(TransportException.Failed::class.java) {
      StoreHttp.Transport.send(StoreRequest("GET", "$store/v1/logs/x", emptyList(), ByteArray(0)))
    }
    assertTrue(e.reason, e.reason.contains("over"))
  }

  @Test
  fun aRedirectAPlainHttpHostAndAStalledStoreAreNoAnswer() {
    // A redirect is not followed, to the same origin or any other: the URL is the store's.
    answer = { Triple(307, mapOf("Location" to "$store/v1/elsewhere"), ByteArray(0)) }
    val moved = assertThrows(TransportException.Failed::class.java) {
      StoreHttp.Transport.send(StoreRequest("GET", "$store/v1/logs/x", emptyList(), ByteArray(0)))
    }
    assertTrue(moved.reason, moved.reason.contains("redirect"))
    assertEquals(1, seen.size)

    // http is for the loopback alone (a debug build's `adb reverse`); anywhere else is https.
    val plain = assertThrows(TransportException.Failed::class.java) {
      StoreHttp.Transport.send(StoreRequest("GET", "http://store.example.org/v1/logs/x", emptyList(), ByteArray(0)))
    }
    assertTrue(plain.reason, plain.reason.contains("https"))
    assertTrue(StoreHttp.allowed(java.net.URL("https://store.example.org/v1/logs/x")))

    // A store that holds the answer past the call's deadline gives none.
    answer = {
      Thread.sleep(3_000)
      Triple(200, emptyMap(), ByteArray(0))
    }
    val started = System.nanoTime()
    val stalled = assertThrows(IOException::class.java) {
      StoreHttp.exchange("GET", "$store/v1/logs/x", emptyList(), null, StoreHttp.MAX_BODY, deadlineMs = 500)
    }
    assertTrue(stalled.message!!, stalled.message!!.contains("within"))
    assertTrue((System.nanoTime() - started) / 1_000_000 < 2_500)
  }

  @Test
  fun theIdentityReachesTheStoreItJoinedSignedByTheDeviceKey() {
    val (keys, scid) = joined()
    val identity = PhoneIdentity(keys, StoreHttp.Transport, SoftMaster(), StoreConfig("https://unused.example.org", emptyList()))

    // A store that answers 503: unreachable, the sentence the page shows as offline.
    val busy = assertThrows(PhoneKeyException.Unavailable::class.java) { identity.status() }
    assertTrue(busy.message!!, busy.message!!.startsWith("Can't connect."))
    val asked = seen.last()
    assertEquals("GET", asked.method)
    assertTrue(asked.path, asked.path.startsWith("/v1/logs/$scid"))

    // A store that is not there at all is the same, through the transport's error.
    server.stop()
    assertThrows(PhoneKeyException.Unavailable::class.java) { identity.status() }
    assertThrows(PhoneKeyException.Unavailable::class.java) { identity.takeMaster(false) }
    assertThrows(PhoneKeyException.Unavailable::class.java) { identity.requests() }
  }

  @Test
  fun codesThatAreNotADevicesAreRefusedBeforeAnythingIsSent() {
    val (keys, _) = joined()
    val identity = PhoneIdentity(keys, StoreHttp.Transport, SoftMaster(), StoreConfig(store, emptyList()))
    val before = seen.size
    assertThrows(PhoneKeyException.Invalid::class.java) { identity.scanDevice("coasys:offer:1:nope") }
    assertThrows(PhoneKeyException.Invalid::class.java) { identity.scanDevice("hello") }
    assertEquals(before, seen.size)
  }

  @Test
  fun aPhoneInNoIdentityHasNoIdentityToShow() {
    val keys = DeviceKeys.open(dir.absolutePath, AesGcmSealer { key })
    keys.create()
    val identity = PhoneIdentity(keys, StoreHttp.Transport, SoftMaster(), StoreConfig(store, emptyList()))
    assertThrows(PhoneKeyException.NoIdentity::class.java) { identity.status() }
    assertThrows(PhoneKeyException.NoIdentity::class.java) { identity.askForMaster() }
    assertTrue(seen.isEmpty())
  }

  /** A phone with a device key, joined to an identity at [store] by the 2a claim. */
  private fun joined(): Pair<DeviceKeys, String> {
    val keys = DeviceKeys.open(dir.absolutePath, AesGcmSealer { key })
    keys.create()
    val random = SecureRandom()
    val scid = DeviceKeysJvmTest.base58(
      byteArrayOf(0x12, 0x20) + MessageDigest.getInstance("SHA-256").digest(ByteArray(16).also(random::nextBytes)),
    )
    val offerId = DeviceKeysJvmTest.base58(ByteArray(16).also(random::nextBytes))
    val s = DeviceKeysJvmTest.base58(ByteArray(32).also(random::nextBytes))
    val json = """{"offerId":"$offerId","s":"$s","scid":"$scid","store":"$store"}"""
    keys.prepareClaim("coasys:offer:1:" + DeviceKeysJvmTest.base58(json.toByteArray()), "Test phone")
    val joined = keys.claimAnswer(200u, """{"state":"spent","seq":1}""") as ClaimProgress.Joined
    assertEquals(scid, joined.member.scid)
    return keys to scid
  }

  /**
   * The app's master sealer without the Keystore and the prompt: the same sealed form, a list of
   * the prompts it would have shown, and a refusal to answer with.
   */
  private class SoftMaster : MasterSealer {
    private val key = DeviceKeysJvmTest.aesKey()
    val prompts = Collections.synchronizedList(mutableListOf<String>())
    @Volatile var refuse: MasterSealException? = null

    override fun protection(): String = "tee"

    override fun seal(label: String, plaintext: ByteArray, prompt: String): ByteArray {
      prompts.add(prompt)
      refuse?.let { throw it }
      val cipher = Cipher.getInstance(AesGcmSealer.TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key)
      cipher.updateAAD(label.toByteArray())
      val ct = cipher.doFinal(plaintext)
      return byteArrayOf(AesGcmSealer.VERSION) + cipher.iv + ct
    }

    override fun open(label: String, sealed: ByteArray, prompt: String): ByteArray {
      prompts.add(prompt)
      refuse?.let { throw it }
      try {
        val cipher = Cipher.getInstance(AesGcmSealer.TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed, 1, AesGcmSealer.IV_BYTES))
        cipher.updateAAD(label.toByteArray())
        return cipher.doFinal(sealed, 1 + AesGcmSealer.IV_BYTES, sealed.size - 1 - AesGcmSealer.IV_BYTES)
      } catch (e: Exception) {
        throw MasterSealException.Failed(e.javaClass.simpleName)
      }
    }

    override fun wipe() {}
  }
}
