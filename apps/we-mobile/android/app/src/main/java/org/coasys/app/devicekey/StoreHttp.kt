package org.coasys.app.devicekey

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import uniffi.we_phone_custody.Header
import uniffi.we_phone_custody.StoreReply
import uniffi.we_phone_custody.StoreRequest
import uniffi.we_phone_custody.StoreTransport
import uniffi.we_phone_custody.TransportException

/**
 * The plugin's requests to an identity store. Plain `HttpURLConnection`, so the platform's TLS and
 * the app's network security config apply. What the store answered, any status, goes back to the
 * Rust side to read; only a request that got no answer throws.
 *
 * [post] and [get] are a claim's two requests (phase 2a). [send] is everything else, the
 * [StoreTransport] the Rust side's `ViaStore` speaks through ([Transport]): any method, the headers
 * the Rust side signed, and bytes both ways.
 *
 * It holds to `ad4m-identity-client`'s `HttpClient` contract (the trait's docs in `store.rs`):
 * - HTTPS only, except http to the phone's own loopback in a debug build (what the debug network
 *   security config allows too: `adb reverse` to a store on the development machine).
 * - No redirect is followed: a 3xx is no answer. The URL the Rust side built is the store's.
 * - The answer is read with a cap and the read fails past it, without reading on to find out how
 *   far past; a declared length past the cap is refused before a byte is read.
 * - A connect timeout, a read timeout, and a deadline on the whole call ([DEADLINE_MS]).
 * - Nothing is logged, and no error carries a header or a body.
 */
internal object StoreHttp {
  data class Answer(val status: Int, val body: String)

  private const val CONNECT_MS = 10_000
  /** Past the store's longest held answer (8 s for a `state`, the same for a request's wait). */
  private const val READ_MS = 20_000
  /** A claim's answers are small. */
  private const val MAX_CLAIM_BODY = 64 * 1024
  /**
   * One page of a log, the largest answer the store gives: `ad4m_ldk::identity::MAX_LOG_PAGE_BYTES`,
   * (256 events + 1) × 64 KiB. The Rust side refuses a body past it, so the transport's cap is not
   * lower.
   */
  const val MAX_BODY = (256 + 1) * 64 * 1024
  /** The whole call, connect to the last byte: a store that trickles must not hold a flow. */
  const val DEADLINE_MS = 60_000L

  private val deadlines = java.util.concurrent.Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "store-http-deadline").apply { isDaemon = true }
  }

  @Throws(IOException::class)
  fun post(url: String, json: String): Answer =
    exchange("POST", url, listOf("Content-Type" to "application/json"), json.toByteArray(Charsets.UTF_8), MAX_CLAIM_BODY)
      .let { Answer(it.status, String(it.body, Charsets.UTF_8)) }

  @Throws(IOException::class)
  fun get(url: String): Answer =
    exchange("GET", url, emptyList(), null, MAX_CLAIM_BODY)
      .let { Answer(it.status, String(it.body, Charsets.UTF_8)) }

  class Raw(val status: Int, val headers: List<Pair<String, String>>, val body: ByteArray)

  @Throws(IOException::class)
  fun exchange(
    method: String,
    url: String,
    headers: List<Pair<String, String>>,
    body: ByteArray?,
    limit: Int,
    deadlineMs: Long = DEADLINE_MS,
  ): Raw {
    val target = URL(url)
    if (!allowed(target)) throw IOException("not an https URL")
    if (method !in METHODS) throw IOException("not a store method: $method")
    val conn = target.openConnection() as HttpURLConnection
    val expired = java.util.concurrent.atomic.AtomicBoolean(false)
    val deadline = deadlines.schedule(
      {
        expired.set(true)
        conn.disconnect()
      },
      deadlineMs,
      java.util.concurrent.TimeUnit.MILLISECONDS,
    )
    try {
      conn.requestMethod = method
      conn.connectTimeout = CONNECT_MS
      conn.readTimeout = READ_MS
      conn.instanceFollowRedirects = false
      conn.useCaches = false
      conn.setRequestProperty("Accept", "application/json")
      headers.forEach { (name, value) -> conn.setRequestProperty(name, value) }
      if (body != null && body.isNotEmpty()) {
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(body.size)
        conn.outputStream.use { it.write(body) }
      }
      val status = conn.responseCode
      if (status in 300..399) throw IOException("the store answered a redirect, which is not followed")
      if (conn.contentLengthLong > limit) throw IOException("the store's answer is over $limit bytes")
      val stream = if (status >= 400) conn.errorStream else conn.inputStream
      val bytes = stream?.use { it.readAtMost(limit) } ?: ByteArray(0)
      val answered = conn.headerFields
        .filterKeys { it != null }
        .flatMap { (name, values) -> values.map { name to it } }
      if (expired.get()) throw IOException("no whole answer within ${deadlineMs / 1000} s")
      return Raw(status, answered, bytes)
    } catch (e: IOException) {
      if (expired.get()) throw IOException("no whole answer within ${deadlineMs / 1000} s")
      throw e
    } finally {
      deadline.cancel(false)
      conn.disconnect()
    }
  }

  /**
   * At most [limit] bytes. An answer past it is refused rather than cut: a cut log or message
   * would only fail to parse on the Rust side, with a less useful sentence.
   */
  private fun java.io.InputStream.readAtMost(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (true) {
      val n = read(buf, 0, buf.size)
      if (n < 0) break
      if (out.size() + n > limit) throw IOException("the store's answer is over $limit bytes")
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }

  private val METHODS = setOf("GET", "POST", "PUT", "DELETE")
  private val LOOPBACK = setOf("127.0.0.1", "localhost", "[::1]", "::1")

  /** https anywhere; http only to the loopback, and only in a debug build. */
  internal fun allowed(target: URL): Boolean = when (target.protocol) {
    "https" -> true
    "http" -> org.coasys.app.BuildConfig.DEBUG && target.host.lowercase() in LOOPBACK
    else -> false
  }

  /**
   * The identity store as the Rust side's HTTP. Blocking: the Rust side calls it on the thread
   * that called into Rust, which is never the main thread (see `crates/phone-custody/src/ports.rs`
   * for why the port is blocking rather than async).
   */
  object Transport : StoreTransport {
    override fun send(request: StoreRequest): StoreReply {
      try {
        val raw = exchange(
          request.method,
          request.url,
          request.headers.map { it.name to it.value },
          request.body,
          MAX_BODY,
        )
        return StoreReply(
          status = raw.status.toUShort(),
          headers = raw.headers.map { (name, value) -> Header(name, value) },
          body = raw.body,
        )
      } catch (e: IOException) {
        throw TransportException.Failed("${e.javaClass.simpleName}: ${e.message ?: "no answer"}")
      }
    }
  }
}
