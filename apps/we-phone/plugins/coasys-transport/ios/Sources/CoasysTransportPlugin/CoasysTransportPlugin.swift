import Capacitor
import Foundation

// UNVERIFIED: written on Linux for spike 1, never compiled. The API mirrors the Kotlin plugin
// (CoasysTransportPlugin.kt) call for call; the uniffi Swift bindings it uses are generated into
// Generated/ by scripts/build-ios.sh, with the Rust library in ios/Frameworks/.

/// The pinned connection to the desktop, for the WebView. All the work is in Rust
/// (crates/phone-transport); this class maps ids to handles and callbacks to events.
@objc(CoasysTransportPlugin)
public class CoasysTransportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CoasysTransportPlugin"
    public let jsName = "CoasysTransport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "runtimeInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
    ]

    /// Closes every connection: a page calls it before its first, to close what an earlier page in
    /// this WebView left open (see the Kotlin plugin).
    @objc func reset(_ call: CAPPluginCall) {
        lock.lock()
        let open = Array(connections.values)
        lock.unlock()
        open.forEach { $0.close() }
        call.resolve(["closed": open.count])
    }

    private let lock = NSLock()
    private var connections: [String: Connection] = [:]

    private func connection(_ id: String) -> Connection? {
        lock.lock(); defer { lock.unlock() }
        return connections[id]
    }

    fileprivate func forget(_ id: String) {
        lock.lock(); defer { lock.unlock() }
        connections.removeValue(forKey: id)
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else { return call.reject("url is required", "bad-url") }
        guard let pin = call.getString("pin") else { return call.reject("pin is required", "bad-pin") }
        let id = call.getString("id") ?? UUID().uuidString
        if self.connection(id) != nil { return call.reject("a connection named \(id) is open", "bad-id") }
        do {
            let handle = try Connection.connect(url: url, pin: pin, listener: Events(id: id, plugin: self))
            lock.lock(); connections[id] = handle; lock.unlock()
            call.resolve(["id": id])
        } catch {
            call.reject("\(error)", "bad-input")
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let text = call.getString("text") else {
            return call.reject("id and text are required")
        }
        guard let handle = connection(id) else { return call.reject("no connection \(id)", "closed") }
        do {
            try handle.send(text: text)
            call.resolve()
        } catch {
            call.reject("\(error)", "closed")
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("id is required") }
        connection(id)?.close()
        call.resolve()
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else { return call.reject("url is required", "bad-url") }
        guard let pin = call.getString("pin") else { return call.reject("pin is required", "bad-pin") }
        let method = call.getString("method") ?? "GET"
        let body = call.getString("body")
        let given = call.getObject("headers") ?? [:]
        let headers = given.compactMap { name, value in (value as? String).map { HttpHeader(name: name, value: $0) } }
        // httpRequest blocks until the response is in: keep it off the plugin queue.
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let response = try httpRequest(url: url, pin: pin, method: method, headers: headers, body: body)
                var out: [String: String] = [:]
                for h in response.headers { out[h.name.lowercased()] = h.value }
                call.resolve(["status": Int(response.status), "headers": out, "body": response.body])
            } catch let RequestError.Failed(kind, detail) {
                call.reject(detail, kind)
            } catch {
                call.reject("\(error)", "closed")
            }
        }
    }

    @objc func runtimeInfo(_ call: CAPPluginCall) {
        call.resolve(["live": Int(liveConnections()), "workers": Int(runtimeWorkers())])
    }
}

/// One connection's callbacks, turned into plugin events. Called on the Rust runtime's threads.
private final class Events: ConnectionListener, @unchecked Sendable {
    private let id: String
    private weak var plugin: CoasysTransportPlugin?

    init(id: String, plugin: CoasysTransportPlugin) {
        self.id = id
        self.plugin = plugin
    }

    func onOpen() {
        plugin?.notifyListeners("open", data: ["id": id])
    }

    func onMessage(text: String) {
        plugin?.notifyListeners("message", data: ["id": id, "text": text])
    }

    func onError(kind: String, message: String) {
        plugin?.notifyListeners("error", data: ["id": id, "kind": kind, "message": message])
    }

    func onClose(code: UInt16, reason: String) {
        // The last event a connection sends: drop the handle, which frees the Rust side.
        plugin?.forget(id)
        plugin?.notifyListeners("close", data: ["id": id, "code": Int(code), "reason": reason])
    }
}
