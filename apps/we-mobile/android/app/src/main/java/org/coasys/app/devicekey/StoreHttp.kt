package org.coasys.app.devicekey

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The plugin's two requests to an identity store: a claim's POST and its `state` GET. Plain
 * `HttpURLConnection`, so the platform's TLS and the app's network security config apply (no
 * cleartext in a release build). What the store answered, any status, goes back to the Rust side
 * to read; only a request that got no answer throws.
 */
internal object StoreHttp {
  data class Answer(val status: Int, val body: String)

  private const val CONNECT_MS = 10_000
  /** Past the store's longest held `state` answer (8 s). */
  private const val READ_MS = 20_000
  private const val MAX_BODY = 64 * 1024

  @Throws(IOException::class)
  fun post(url: String, json: String): Answer = request(url, "POST", json)

  @Throws(IOException::class)
  fun get(url: String): Answer = request(url, "GET", null)

  private fun request(url: String, method: String, json: String?): Answer {
    val target = URL(url)
    if (target.protocol != "https" && target.protocol != "http") {
      throw IOException("not an http(s) URL")
    }
    val conn = target.openConnection() as HttpURLConnection
    try {
      conn.requestMethod = method
      conn.connectTimeout = CONNECT_MS
      conn.readTimeout = READ_MS
      conn.instanceFollowRedirects = false
      conn.setRequestProperty("Accept", "application/json")
      if (json != null) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setFixedLengthStreamingMode(bytes.size)
        conn.outputStream.use { it.write(bytes) }
      }
      val status = conn.responseCode
      val stream = if (status >= 400) conn.errorStream else conn.inputStream
      val body = stream?.use { input ->
        val bytes = input.readNBytesCompat(MAX_BODY)
        String(bytes, Charsets.UTF_8)
      } ?: ""
      return Answer(status, body)
    } finally {
      conn.disconnect()
    }
  }

  /** At most [limit] bytes: a store's answers are small, and a larger one is not read whole. */
  private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (out.size() < limit) {
      val n = read(buf, 0, minOf(buf.size, limit - out.size()))
      if (n < 0) break
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }
}
