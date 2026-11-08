package org.coasys.transport

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import uniffi.we_phone_transport.HttpHeader
import uniffi.we_phone_transport.RequestException
import uniffi.we_phone_transport.httpRequest
import uniffi.we_phone_transport.Connection
import uniffi.we_phone_transport.ConnectionListener
import uniffi.we_phone_transport.TransportException
import uniffi.we_phone_transport.liveConnections
import uniffi.we_phone_transport.runtimeWorkers

/**
 * The pinned connection to the desktop, for the WebView.
 *
 * All the work is in Rust (`crates/phone-transport`), reached through the uniffi Kotlin bindings
 * and `libwe_phone_transport.so`. This class only maps ids to handles and callbacks to events.
 * The listener callbacks run on the Rust runtime's threads; `notifyListeners` is safe there.
 */
@CapacitorPlugin(name = "CoasysTransport")
class CoasysTransportPlugin : Plugin() {
    private val connections = ConcurrentHashMap<String, Connection>()

    // `request` blocks until the response is in. Plugin calls share one thread, so a slow request
    // there would hold up every socket's `send`; requests get threads of their own.
    private val requests = Executors.newCachedThreadPool()

    /**
     * Closes every connection. A connection belongs to the page that opened it; when the WebView
     * loads another page (a reload, the pairing screen handing over to WE), nothing is left to read
     * its events or close it. So each page calls this before its first connection.
     *
     * The page asks rather than the plugin watching navigation: Capacitor's `WebViewListener`
     * `onPageStarted` did not fire for these navigations on the emulator, and a page knows for
     * certain when it starts.
     */
    @PluginMethod
    fun reset(call: PluginCall) {
        val open = connections.size
        connections.values.forEach { it.disconnect() }
        call.resolve(JSObject().put("closed", open))
    }

    @PluginMethod
    fun request(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url is required", "bad-url")
        val pin = call.getString("pin") ?: return call.reject("pin is required", "bad-pin")
        val method = call.getString("method") ?: "GET"
        val body = call.getString("body")
        val given = call.getObject("headers") ?: JSObject()
        val headers = given.keys().asSequence().map { HttpHeader(it, given.getString(it) ?: "") }.toList()
        requests.execute {
            try {
                val response = httpRequest(url, pin, method, headers, body)
                val out = JSObject()
                response.headers.forEach { out.put(it.name.lowercase(), it.value) }
                call.resolve(
                    JSObject()
                        .put("status", response.status.toInt())
                        .put("headers", out)
                        .put("body", response.body),
                )
            } catch (e: RequestException.Failed) {
                call.reject(e.detail, e.kind)
            }
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url is required", "bad-url")
        val pin = call.getString("pin") ?: return call.reject("pin is required", "bad-pin")
        val id = call.getString("id") ?: UUID.randomUUID().toString()
        if (connections.containsKey(id)) return call.reject("a connection named $id is open", "bad-id")
        try {
            connections[id] = Connection.connect(url, pin, Events(id))
            call.resolve(JSObject().put("id", id))
        } catch (e: TransportException) {
            call.reject(e.message, "bad-input")
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id is required")
        val text = call.getString("text") ?: return call.reject("text is required")
        val connection = connections[id] ?: return call.reject("no connection $id", "closed")
        try {
            connection.send(text)
            call.resolve()
        } catch (e: TransportException) {
            call.reject(e.message, "closed")
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id is required")
        // `disconnect` is Rust's `Connection::close` (see crates/phone-transport/uniffi.toml).
        connections[id]?.disconnect()
        call.resolve()
    }

    @PluginMethod
    fun runtimeInfo(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("live", liveConnections().toInt())
                .put("workers", runtimeWorkers().toInt()),
        )
    }

    override fun handleOnDestroy() {
        connections.values.forEach { it.disconnect() }
        connections.clear()
        requests.shutdown()
    }

    private inner class Events(private val id: String) : ConnectionListener {
        override fun onOpen() {
            notifyListeners("open", JSObject().put("id", id))
        }

        override fun onMessage(text: String) {
            notifyListeners("message", JSObject().put("id", id).put("text", text))
        }

        override fun onError(kind: String, message: String) {
            notifyListeners("error", JSObject().put("id", id).put("kind", kind).put("message", message))
        }

        override fun onClose(code: UShort, reason: String) {
            // The last event a connection sends: forget the handle, which frees the Rust side.
            connections.remove(id)?.destroy()
            notifyListeners("close", JSObject().put("id", id).put("code", code.toInt()).put("reason", reason))
        }
    }
}
