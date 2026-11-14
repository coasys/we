package org.coasys.app.devicekey

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AlertDialog
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.coasys.app.BuildConfig
import org.json.JSONObject
import uniffi.we_phone_custody.AnswerView
import uniffi.we_phone_custody.AskedView
import uniffi.we_phone_custody.ClaimProgress
import uniffi.we_phone_custody.DeviceKeys
import uniffi.we_phone_custody.DevicePublic
import uniffi.we_phone_custody.DeviceView
import uniffi.we_phone_custody.HolderLink
import uniffi.we_phone_custody.IdentityView
import uniffi.we_phone_custody.KeyStatus
import uniffi.we_phone_custody.LinkStep
import uniffi.we_phone_custody.MasterTaken
import uniffi.we_phone_custody.PhoneIdentity
import uniffi.we_phone_custody.PhoneKeyException
import uniffi.we_phone_custody.RequestView
import uniffi.we_phone_custody.SealException
import uniffi.we_phone_custody.SessionPurpose
import uniffi.we_phone_custody.SessionRequest
import uniffi.we_phone_custody.StoreConfig

/**
 * `DeviceKey`: the phone's device key, enc key and (when it holds one) master key, to WE's web
 * build. The keys are made and kept by `crates/phone-custody` (Rust, through uniffi): the device
 * seeds sealed by the Keystore key [KeystoreKey], a master seed by the biometric-gated
 * [MasterKeystoreKey]. Only public keys, the identity's DID, signed statements, match codes and
 * progress come back; nothing here takes or returns a secret.
 *
 * Phase 2a, the device key:
 *
 *   status()                        → {keys, identity, pending, protection}
 *   create()                        → {sign, enc, didKey, protection}
 *   join({link, hint?})             → {did, matchCode, progress}
 *   waitJoined({seconds?})          → {progress}
 *   signSession({purpose, executor, url, challenge, grant?}) → {statement, sig}
 *
 * Phase 2b, the identity through the store (every call needs a joined phone):
 *
 *   identityStatus()                → {did, keyId, fingerprint, revoked, masterIndex, protection, store, head, biometrics}
 *   takeMaster()                    → {taken: {did, index, note} | null}      (one prompt)
 *   askForMaster()                  → {requestId, keyId, fingerprint, code}
 *   requests()                      → {requests: [{id, kind, by, device, fingerprint, code, targets, rotate, expires, problem}]}
 *   answer({id})                    → {kind, device, note}                     (one prompt)
 *   devices()                       → {devices: [{keyId, fingerprint, name, kind, addedSeq, revokedSeq, thisDevice, holdsMaster, masterIndex, mayKeepMaster, bot}]}
 *   rename({keyId, name})           → {}
 *   revoke({keyIds})                → {note}                                   (one prompt)
 *   scanDevice({code})              → {link}                                   (one prompt, for the ticket)
 *   linkNext({link})                → {step: "ticket-sent", expires} | {step: "claimed", code, hint, canKeepMaster} | {step: "linked", keyId, seq, masterSent, note}
 *   linkConfirm({link, name?, keepMaster}) → {}                                (no prompt; the scan's one unlock covers the add)
 *   linkCancel({link})              → {}
 *   scanCode({prefix, title?})      → {text}                                   (the camera; rejects `Cancelled` or `CameraDenied`)
 *
 * The TypeScript side of this surface is `apps/we-web/src/platform/deviceKey.ts`. Every call runs
 * off the main thread, on a pool of the plugin's own (a link's `linkNext` waits minutes for the
 * other device, and must not hold up a key login behind it). A refusal rejects with the Rust
 * error's variant as its code (`NoKeys`, `Unavailable`, `Cancelled`, `WeakProtection`, …) and its
 * sentence as the message.
 */
@CapacitorPlugin(name = "DeviceKey")
class DeviceKeyPlugin : Plugin() {
  private var opened: DeviceKeys? = null
  private var identity: PhoneIdentity? = null
  private val master by lazy { BiometricMasterSealer(context.applicationContext) { activity } }
  private val links = ConcurrentHashMap<String, HolderLink>()
  /** Link ids a call is inside a method on: [sweepLinks] must not close one under the call. */
  private val inUse = ConcurrentHashMap.newKeySet<String>()
  private val pool: ExecutorService = Executors.newCachedThreadPool { r ->
    Thread(r, "device-key").apply { isDaemon = true }
  }

  /**
   * The key file lives in `noBackupFilesDir`, which Android leaves out of every backup and device
   * transfer: the sealed seeds are useless without this phone's Keystore key, and are kept off
   * other machines anyway. The master key's sealed file is beside it.
   */
  @Synchronized
  private fun keys(): DeviceKeys {
    opened?.let { return it }
    // Not `mkdirs()`: Rust makes the directory when it first writes into it, syncing every
    // ancestor that gained an entry, so the name itself is durable.
    val dir = File(context.noBackupFilesDir, "device-keys")
    val made = DeviceKeys.open(dir.absolutePath, AesGcmSealer { KeystoreKey.getOrCreate() })
    opened = made
    return made
  }

  @Synchronized
  private fun identity(): PhoneIdentity {
    identity?.let { return it }
    val made = PhoneIdentity(keys(), StoreHttp.Transport, master, storeConfig())
    identity = made
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
      val pending = keys.status().pending ?: throw Refusal("NoClaim", "This phone isn't waiting to join. Start again.")
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

  @PluginMethod
  fun identityStatus(call: PluginCall) = run(call) {
    identityJson(identity().status()).put("biometrics", master.canAuthenticate())
  }

  /**
   * Takes the master key waiting in the inbox. A phone with no strong biometric is refused before
   * anything is read. A phone whose Keystore is not secure hardware (`software`, as on an
   * emulator) keeps it only once the person has agreed in [agreeToWeakProtection]; declining
   * leaves the key in the inbox, untaken.
   */
  @PluginMethod
  fun takeMaster(call: PluginCall) = run(call) {
    if (!master.canAuthenticate()) {
      throw Refusal("NoBiometrics", "Set up fingerprint or face unlock to keep the master key on this phone.")
    }
    val identity = identity()
    val taken = try {
      identity.takeMaster(false)
    } catch (e: PhoneKeyException.WeakProtection) {
      if (!agreeToWeakProtection()) {
        throw Refusal("WeakProtection", e.message ?: "The master key wasn't kept on this phone.")
      }
      identity.takeMaster(true)
    }
    JSObject().put("taken", taken?.let(::takenJson) ?: JSONObject.NULL)
  }

  @PluginMethod
  fun askForMaster(call: PluginCall) = run(call) {
    askedJson(identity().askForMaster())
  }

  @PluginMethod
  fun masterWaiting(call: PluginCall) = run(call) {
    JSObject().put("waiting", identity().masterWaiting())
  }

  @PluginMethod
  fun requests(call: PluginCall) = run(call) {
    JSObject().put("requests", JSArray(identity().requests().map(::requestJson)))
  }

  @PluginMethod
  fun answer(call: PluginCall) = run(call) {
    val id = call.getString("id") ?: throw Refusal("Invalid", "answer needs the request's id")
    answerJson(identity().answer(id))
  }

  @PluginMethod
  fun devices(call: PluginCall) = run(call) {
    JSObject().put("devices", JSArray(identity().devices().map(::deviceJson)))
  }

  @PluginMethod
  fun rename(call: PluginCall) = run(call) {
    val keyId = call.getString("keyId") ?: throw Refusal("Invalid", "rename needs the device's keyId")
    val name = call.getString("name")?.trim()?.takeIf { it.isNotEmpty() }
      ?: throw Refusal("Invalid", "Enter a name for the device.")
    identity().rename(keyId, name)
    JSObject()
  }

  @PluginMethod
  fun revoke(call: PluginCall) = run(call) {
    val keyIds = call.getArray("keyIds")?.toList<String>()?.takeIf { it.isNotEmpty() }
      ?: throw Refusal("Invalid", "revoke needs the keyIds of the devices")
    JSObject().put("note", identity().revoke(keyIds) ?: JSONObject.NULL)
  }

  @PluginMethod
  fun scanDevice(call: PluginCall) = run(call) {
    val code = call.getString("code") ?: throw Refusal("Invalid", "scanDevice needs the device's code")
    val link = identity().scanDevice(code)
    val id = UUID.randomUUID().toString()
    links[id] = link
    JSObject().put("link", id)
  }

  @PluginMethod
  fun linkNext(call: PluginCall) = run(call) {
    withLink(call) { id, link ->
      try {
        val step = link.next()
        if (step is LinkStep.Linked && links.remove(id, link)) link.close()
        stepJson(step)
      } catch (e: Exception) {
        if (links.remove(id, link)) link.close()
        throw e
      }
    }
  }

  @PluginMethod
  fun linkConfirm(call: PluginCall) = run(call) {
    withLink(call) { _, link ->
      link.confirm(call.getString("name"), call.getBoolean("keepMaster") ?: false)
      JSObject()
    }
  }

  @PluginMethod
  fun linkCancel(call: PluginCall) = run(call) {
    val id = call.getString("link") ?: throw Refusal("Invalid", "linkCancel needs the link")
    // Removed and closed here: the entry does not wait for a linkNext that may never come.
    // A `next` in flight on it keeps the native link alive through its own Arc.
    links.remove(id)?.let { it.cancel(); it.close() }
    JSObject()
  }

  /** Opens the camera on a QR code whose text starts with `prefix`; the text, uninterpreted. */
  @PluginMethod
  fun scanCode(call: PluginCall) {
    val prefix = call.getString("prefix")
    if (prefix.isNullOrEmpty() || !prefix.startsWith("coasys:")) {
      call.reject("scanCode needs the prefix of the code it reads", "Invalid")
      return
    }
    val intent = Intent(context, ScanActivity::class.java)
      .putExtra(ScanActivity.EXTRA_PREFIX, prefix)
      .putExtra(ScanActivity.EXTRA_TITLE, call.getString("title"))
    startActivityForResult(call, intent, "scanned")
  }

  @ActivityCallback
  private fun scanned(call: PluginCall?, result: ActivityResult) {
    call ?: return
    val text = result.data?.getStringExtra(ScanActivity.EXTRA_TEXT)
    when {
      text != null -> call.resolve(JSObject().put("text", text))
      result.data?.getStringExtra(ScanActivity.EXTRA_REASON) == "denied" ->
        call.reject("Allow camera access to scan, or paste the code.", "CameraDenied")
      result.data?.getStringExtra(ScanActivity.EXTRA_REASON) == "no-camera" ->
        call.reject("Can't start the camera. Paste the code instead.", "NoCamera")
      else -> call.reject("the scan was cancelled", "Cancelled")
    }
  }

  override fun handleOnDestroy() {
    links.keys.toList().forEach { id -> links.remove(id)?.let { it.cancel(); it.close() } }
    super.handleOnDestroy()
  }

  /**
   * Runs [block] with the call's link, the id marked in use so [sweepLinks] — which runs on
   * every plugin call — cannot close the link under it.
   */
  private fun <T> withLink(call: PluginCall, block: (String, HolderLink) -> T): T {
    val id = call.getString("link") ?: throw Refusal("Invalid", "the call needs the link")
    inUse.add(id)
    try {
      val link = links[id] ?: throw Refusal("Ended", "This link has ended. Start again.")
      return block(id, link)
    } finally {
      inUse.remove(id)
    }
  }

  /**
   * Removes and closes the links whose native side ended — expired, errored, cancelled or
   * linked — whether or not a `linkNext` ever polled the end. One pass over the map on each
   * plugin call keeps the map to links that are live.
   */
  private fun sweepLinks() {
    for ((id, link) in links) {
      if (link.ended() && !inUse.contains(id) && links.remove(id, link)) {
        link.close()
      }
    }
  }

  /**
   * The one question asked before a master key is kept below secure hardware. Blocks the calling
   * (worker) thread until the person answers; closing the dialog any other way is a no.
   */
  private fun agreeToWeakProtection(): Boolean {
    val host = activity ?: return false
    val agreed = AtomicBoolean(false)
    val answered = CountDownLatch(1)
    host.runOnUiThread {
      AlertDialog.Builder(host)
        .setTitle("Keep master key without a secure chip?")
        .setMessage(
          "This phone doesn't keep keys in a secure chip. Anyone who can read this app's files " +
            "could use your master key without your fingerprint.\n\n" +
            "Keep it here only on a phone you use for testing.",
        )
        .setPositiveButton("Keep anyway") { _, _ -> agreed.set(true) }
        .setNegativeButton("Don't keep", null)
        .setOnDismissListener { answered.countDown() }
        .show()
    }
    answered.await()
    return agreed.get()
  }

  /** Runs [body] off the main thread and answers [call] with what it returned, or why not. */
  private fun run(call: PluginCall, body: () -> JSObject) {
    pool.execute {
      sweepLinks()
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

    /** The store the app is built for (`BuildConfig`, from the build's environment). */
    fun storeConfig(): StoreConfig = StoreConfig(
      url = BuildConfig.IDENTITY_STORE_URL,
      keys = BuildConfig.IDENTITY_STORE_KEYS.split(',').map { it.trim() }.filter { it.isNotEmpty() },
    )

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

    private fun Any?.orNull(): Any = this ?: JSONObject.NULL

    fun identityJson(v: IdentityView): JSObject = JSObject()
      .put("did", v.did)
      .put("keyId", v.keyId.orNull())
      .put("fingerprint", v.fingerprint)
      .put("revoked", v.revoked?.toLong().orNull())
      .put("masterIndex", v.masterIndex?.toLong().orNull())
      .put("protection", v.protection)
      .put("store", v.store)
      .put("head", v.head?.toLong().orNull())

    fun takenJson(v: MasterTaken): JSObject = JSObject()
      .put("did", v.did)
      .put("index", v.index.toLong())
      .put("note", v.note.orNull())

    fun askedJson(v: AskedView): JSObject = JSObject()
      .put("requestId", v.requestId)
      .put("keyId", v.keyId)
      .put("fingerprint", v.fingerprint)
      .put("code", v.code)

    fun requestJson(v: RequestView): JSObject = JSObject()
      .put("id", v.id)
      .put("kind", v.kind)
      .put("by", v.by)
      .put("device", v.device)
      .put("fingerprint", v.fingerprint)
      .put("code", v.code)
      .put("targets", JSArray(v.targets))
      .put("targetKeys", JSArray(v.targetKeys))
      .put("rotate", v.rotate)
      .put("expires", v.expires.toLong())
      .put("problem", v.problem.orNull())

    fun answerJson(v: AnswerView): JSObject = JSObject()
      .put("kind", v.kind)
      .put("device", v.device)
      .put("note", v.note.orNull())

    fun deviceJson(v: DeviceView): JSObject = JSObject()
      .put("keyId", v.keyId)
      .put("fingerprint", v.fingerprint)
      .put("name", v.name)
      .put("kind", v.kind.orNull())
      .put("addedSeq", v.addedSeq.toLong())
      .put("revokedSeq", v.revokedSeq?.toLong().orNull())
      .put("thisDevice", v.thisDevice)
      .put("holdsMaster", v.holdsMaster)
      .put("masterIndex", v.masterIndex?.toLong().orNull())
      .put("mayKeepMaster", v.mayKeepMaster)
      .put("bot", v.bot)

    fun stepJson(step: LinkStep): JSObject = when (step) {
      is LinkStep.TicketSent -> JSObject().put("step", "ticket-sent").put("expires", step.expires.toLong())
      is LinkStep.Claimed ->
        JSObject()
          .put("step", "claimed")
          .put("code", step.code)
          .put("hint", step.hint.orNull())
          .put("canKeepMaster", step.canKeepMaster)
      is LinkStep.Linked ->
        JSObject()
          .put("step", "linked")
          .put("keyId", step.keyId)
          .put("seq", step.seq.toLong())
          .put("masterSent", step.masterSent)
          .put("note", step.note.orNull())
    }
  }
}
