package org.coasys.app.devicekey

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import uniffi.we_phone_custody.PhoneInput
import uniffi.we_phone_custody.PhoneScreen
import uniffi.we_phone_custody.RestoreDeviceView

/**
 * The identity steps' screens and inputs (`crates/phone-custody/src/steps.rs`) as the JSON the
 * phone's screens send and read. A screen is `{screen: "<name>", …}`, an input is
 * `{input: "<name>", …}`; the names are the Rust variants' in kebab case.
 *
 * Screens:
 *
 *   {screen: "show-words", words: [12]}                       → input "words-written"
 *   {screen: "confirm-words", positions: [2], error}          → input "confirm-words" {first, second}
 *   {screen: "name-device"}                                   → input "name-device" {name?}
 *   {screen: "enter-words", purpose: "restore"|"replace", error, position}
 *                                                             → input "twelve-words" {words}
 *   {screen: "restore-devices", did, devices: [{keyId, name, kind, lockOut}], note}
 *                                                             → input "lock-out" {keyIds, name?}
 *   {screen: "identity-ready", did, keyId, note}              (the end)
 *   {screen: "make-stopped", did, reason, pending}            → input "try-again"
 *   {screen: "restored", did, name, keyId, revoked, note}     (the end)
 *   {screen: "restore-not-linked", did, revoked, reason}      → input "try-again"
 *   {screen: "master-replaced", index, revoked, note}         (the end)
 *   {screen: "master-not-kept", index, revoked, reason, note} → input "try-again"
 *
 * The words cross here as plain strings, which the JVM cannot wipe: the plugin holds no copy past
 * the call, and the page shows them with the window secure ([DeviceKeyPlugin.setSecure]).
 */
object IdentityStepsJson {
  fun screenJson(screen: PhoneScreen): JSObject = when (screen) {
    is PhoneScreen.ShowWords -> named("show-words").put("words", JSArray(screen.words))
    is PhoneScreen.ConfirmWords ->
      named("confirm-words")
        .put("positions", JSArray(screen.positions.map { it.toLong() }))
        .put("error", screen.error.orNull())
    is PhoneScreen.NameDevice -> named("name-device")
    is PhoneScreen.EnterWords ->
      named("enter-words")
        .put("purpose", screen.purpose)
        .put("error", screen.error.orNull())
        .put("position", screen.position?.toLong().orNull())
    is PhoneScreen.RestoreDevices ->
      named("restore-devices")
        .put("did", screen.did)
        .put("devices", JSArray(screen.devices.map(::deviceJson)))
        .put("note", screen.note.orNull())
    is PhoneScreen.IdentityReady ->
      named("identity-ready").put("did", screen.did).put("keyId", screen.keyId).put("note", screen.note.orNull())
    is PhoneScreen.MakeStopped ->
      named("make-stopped")
        .put("did", screen.did.orNull())
        .put("reason", screen.reason)
        .put("pending", screen.pending)
    is PhoneScreen.Restored ->
      named("restored")
        .put("did", screen.did)
        .put("name", screen.name)
        .put("keyId", screen.keyId)
        .put("revoked", JSArray(screen.revoked))
        .put("note", screen.note.orNull())
    is PhoneScreen.RestoreNotLinked ->
      named("restore-not-linked")
        .put("did", screen.did)
        .put("revoked", JSArray(screen.revoked))
        .put("reason", screen.reason)
    is PhoneScreen.MasterReplaced ->
      named("master-replaced")
        .put("index", screen.index.toLong())
        .put("revoked", JSArray(screen.revoked))
        .put("note", screen.note.orNull())
    is PhoneScreen.MasterNotKept ->
      named("master-not-kept")
        .put("index", screen.index.toLong())
        .put("revoked", JSArray(screen.revoked))
        .put("reason", screen.reason)
        .put("note", screen.note.orNull())
  }

  /**
   * The input [json] names; [IllegalArgumentException] with the sentence to show when it names
   * none, or leaves out what its input needs. Whether it answers the screen shown is the flow's to
   * say (`WrongInput`).
   */
  fun inputOf(json: JSONObject?): PhoneInput {
    json ?: throw IllegalArgumentException("the step needs its input")
    return when (val kind = json.optString("input")) {
      "words-written" -> PhoneInput.WordsWritten
      "confirm-words" -> PhoneInput.ConfirmWords(required(json, "first"), required(json, "second"))
      "name-device" -> PhoneInput.NameDevice(optional(json, "name"))
      "twelve-words" -> PhoneInput.TwelveWords(required(json, "words"))
      "lock-out" -> {
        val ids = json.optJSONArray("keyIds") ?: JSONArray()
        PhoneInput.LockOut((0 until ids.length()).map { ids.getString(it) }, optional(json, "name"))
      }
      "try-again" -> PhoneInput.TryAgain
      "" -> throw IllegalArgumentException("the step needs its input")
      else -> throw IllegalArgumentException("\"$kind\" is not an input of the identity steps")
    }
  }

  private fun named(screen: String): JSObject = JSObject().put("screen", screen)

  private fun deviceJson(v: RestoreDeviceView): JSObject = JSObject()
    .put("keyId", v.keyId)
    .put("name", v.name.orNull())
    .put("kind", v.kind.orNull())
    .put("lockOut", v.lockOut)

  private fun required(json: JSONObject, key: String): String =
    json.optString(key).takeIf { json.has(key) && !json.isNull(key) }
      ?: throw IllegalArgumentException("the input needs \"$key\"")

  private fun optional(json: JSONObject, key: String): String? =
    if (json.has(key) && !json.isNull(key)) json.getString(key) else null

  private fun Any?.orNull(): Any = this ?: JSONObject.NULL
}
