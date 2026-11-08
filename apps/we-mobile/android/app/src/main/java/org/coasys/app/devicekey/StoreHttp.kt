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
 * the app's network security config apply (no cleartext in a release build). What the store
 * answered, any status, goes back to the Rust side to read; only a request that got no answer
 * throws.
 *
 * [post] and [get] are a claim's two requests (phase 2a). [send] is everything else, the
 * [StoreTransport] the Rust side's `ViaStore` speaks through ([Transport]): any method, the headers
 * the Rust side signed, and bytes both ways.
 */
internal object StoreHttp {
  data class Answer(val status: Int, val body: String)

  private const val CONNECT_MS = 10_000
  /** Past the store's longest held answer (8 s for a `state`, the same for a request's wait). */
  private const val READ_MS = 20_000
  /** A claim's answers are small. */
  private const val MAX_CLAIM_BODY = 64 * 1024
  /** A log of a long-lived identity, or a full inbox, is the largest answer the store gives. */
  const val MAX_BODY = 4 * 1024 * 1024

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
  ): Raw {
    val target = URL(url)
    if (target.protocol != "https" && target.protocol != "http") {
      throw IOException("not an http(s) URL")
    }
    if (method !in METHODS) throw IOException("not a store method: $method")
    val conn = target.openConnection() as HttpURLConnection
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
      val stream = if (status >= 400) conn.errorStream else conn.inputStream
      val bytes = stream?.use { it.readAtMost(limit) } ?: ByteArray(0)
      val answered = conn.headerFields
        .filterKeys { it != null }
        .flatMap { (name, values) -> values.map { name to it } }
      return Raw(status, answered, bytes)
    } finally {
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
