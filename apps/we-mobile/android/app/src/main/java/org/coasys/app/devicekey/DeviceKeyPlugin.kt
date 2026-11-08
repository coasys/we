package org.coasys.app.devicekey

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.IOException
import org.json.JSONObject
import uniffi.we_phone_custody.ClaimProgress
import uniffi.we_phone_custody.DeviceKeys
import uniffi.we_phone_custody.DevicePublic
import uniffi.we_phone_custody.KeyStatus
import uniffi.we_phone_custody.PhoneKeyException
import uniffi.we_phone_custody.SealException
import uniffi.we_phone_custody.SessionPurpose
import uniffi.we_phone_custody.SessionRequest

/**
 * `DeviceKey`: the phone's device key and enc key, to WE's web build. The keys are made and kept
 * by `crates/phone-custody` (Rust, through uniffi), their seeds sealed by the Keystore key
 * ([KeystoreKey]). Only public keys, the identity's DID and signed statements come back; nothing
 * here takes or returns a secret.
 *
 *   status()                        → {keys, identity, pending, protection}
 *   create()                        → {sign, enc, didKey, protection}
 *   join({link, hint?})             → {did, matchCode, progress}
 *   waitJoined({seconds?})          → {progress}
 *   signSession({purpose, executor, url, challenge, grant?}) → {statement, sig}
 *
 * The TypeScript side of this surface is `apps/we-web/src/platform/deviceKey.ts`. Every call runs
 * off the main thread; a refusal rejects with the Rust error's variant as its code
 * (`NoKeys`, `KeysExist`, `AlreadyJoined`, `Invalid`, …) and its sentence as the message.
 */
@CapacitorPlugin(name = "DeviceKey")
class DeviceKeyPlugin : Plugin() {
  private var opened: DeviceKeys? = null

  /**
   * The key file lives in `noBackupFilesDir`, which Android leaves out of every backup and device
   * transfer: the sealed seeds are useless without this phone's Keystore key, and are kept off
   * other machines anyway.
   */
  @Synchronized
  private fun keys(): DeviceKeys {
    opened?.let { return it }
    val dir = File(context.noBackupFilesDir, "device-keys").apply { mkdirs() }
    val made = DeviceKeys.open(dir.absolutePath, AesGcmSealer { KeystoreKey.getOrCreate() })
    opened = made
    return made
  }

  @PluginMethod
  fun status(call: PluginCall) = run(call) {
    statusJson(keys().status())
  }

  @PluginMethod
  fun create(call: PluginCall) = run(call) {
    publicJson(keys().create()).put("protection", protection())
  }

  @PluginMethod
  fun join(call: PluginCall) = run(call) {
    val link = call.getString("link") ?: throw Refusal("Invalid", "join needs the offer link")
    val keys = keys()
    val prepared = keys.prepareClaim(link, call.getString("hint"))
    val progress = try {
      val answer = StoreHttp.post(prepared.claimUrl, prepared.body)
      keys.claimAnswer(answer.status.toUShort(), answer.body)
    } catch (e: IOException) {
      // Not sent, or not answered: the claim stays pending, and waitJoined asks again.
      ClaimProgress.Waiting("unreachable")
    }
    JSObject()
      .put("did", prepared.did)
      .put("matchCode", prepared.matchCode)
      .put("progress", progressJson(progress))
  }

  @PluginMethod
  fun waitJoined(call: PluginCall) = run(call) {
    val seconds = (call.getInt("seconds") ?: 60).coerceIn(0, 600)
    val keys = keys()
    val deadline = System.nanoTime() + seconds * 1_000_000_000L
    var progress: ClaimProgress
    do {
      val pending = keys.status().pending ?: throw Refusal("NoClaim", "no claim is waiting")
      val left = ((deadline - System.nanoTime()) / 1_000_000_000L).coerceIn(0, STATE_WAIT_SECONDS)
      progress = try {
        val answer = StoreHttp.get("${pending.stateUrl}&wait=$left")
        keys.claimAnswer(answer.status.toUShort(), answer.body)
      } catch (e: IOException) {
        Thread.sleep(1_000)
        ClaimProgress.Waiting("unreachable")
      }
    } while (progress is ClaimProgress.Waiting && System.nanoTime() < deadline)
    JSObject().put("progress", progressJson(progress))
  }

  @PluginMethod
  fun signSession(call: PluginCall) = run(call) {
    val purpose = when (call.getString("purpose")) {
      "login" -> SessionPurpose.LOGIN
      "renew" -> SessionPurpose.RENEW
      else -> throw Refusal("Invalid", "purpose is login or renew")
    }
    val request = SessionRequest(
      purpose = purpose,
      executor = call.getString("executor") ?: throw Refusal("Invalid", "executor is missing"),
      url = call.getString("url") ?: throw Refusal("Invalid", "url is missing"),
      challenge = call.getString("challenge") ?: throw Refusal("Invalid", "challenge is missing"),
      grant = call.getString("grant"),
    )
    JSObject(keys().signSession(request))
  }

  /** Runs [body] off the main thread and answers [call] with what it returned, or why not. */
  private fun run(call: PluginCall, body: () -> JSObject) {
    execute {
      try {
        call.resolve(body())
      } catch (e: Refusal) {
        call.reject(e.message, e.code)
      } catch (e: PhoneKeyException) {
        call.reject(e.message ?: e.javaClass.simpleName, e.javaClass.simpleName)
      } catch (e: SealException) {
        call.reject(e.message ?: "the Keystore refused", "Sealer")
      } catch (e: Exception) {
        call.reject(e.message ?: e.javaClass.simpleName, "Failed", e)
      }
    }
  }

  private fun protection(): String =
    KeystoreKey.existing()?.let { KeystoreKey.protectionOf(it).word } ?: "none"

  private fun statusJson(status: KeyStatus): JSObject {
    val out = JSObject()
    out.put("keys", status.keys?.let(::publicJson) ?: JSONObject.NULL)
    out.put(
      "identity",
      status.identity?.let { m ->
        JSObject().put("scid", m.scid).put("did", m.did).put("seq", m.seq?.toLong() ?: JSONObject.NULL)
      } ?: JSONObject.NULL,
    )
    out.put(
      "pending",
      status.pending?.let { p ->
        JSObject()
          .put("did", p.did)
          .put("offerId", p.offerId)
          .put("store", p.store)
          .put("matchCode", p.matchCode)
      } ?: JSONObject.NULL,
    )
    out.put("protection", protection())
    return out
  }

  private class Refusal(val code: String, message: String) : Exception(message)

  companion object {
    /** The store holds a `state` answer at most 8 seconds. */
    private const val STATE_WAIT_SECONDS = 8L

    fun publicJson(keys: DevicePublic): JSObject =
      JSObject().put("sign", keys.sign).put("enc", keys.enc).put("didKey", keys.didKey)

    fun progressJson(progress: ClaimProgress): JSObject = when (progress) {
      is ClaimProgress.Waiting -> JSObject().put("state", "waiting").put("detail", progress.state)
      is ClaimProgress.Joined ->
        JSObject()
          .put("state", "joined")
          .put("did", progress.member.did)
          .put("scid", progress.member.scid)
          .put("seq", progress.member.seq?.toLong() ?: JSONObject.NULL)
      is ClaimProgress.Ended -> JSObject().put("state", "ended").put("reason", progress.reason)
    }
  }
}
