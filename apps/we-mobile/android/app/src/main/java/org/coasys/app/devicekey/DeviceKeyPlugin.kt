package org.coasys.app.devicekey

import android.content.Intent
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AlertDialog
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.WebViewListener
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
import uniffi.we_phone_custody.IdentitySteps
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
 * The device key and key login:
 *
 *   status()                        → {keys, identity, pending, protection}
 *   create()                        → {sign, enc, didKey, protection}
 *   join({link, hint?})             → {did, matchCode, progress}
 *   waitJoined({seconds?})          → {progress}
 *   signSession({purpose, executor, url, challenge, grant?}) → {statement, sig}   (one prompt, naming the address)
 *
 * The identity through the store (every call needs a joined phone):
 *
 *   identityStatus()                → {did, keyId, fingerprint, revoked, masterIndex, protection, store, head, biometrics}
 *   takeMaster()                    → {taken: {did, index, note} | null}      (one prompt)
 *   askForMaster()                  → {requestId, keyId, fingerprint, code}
 *   requests()                      → {requests: [{id, kind, by, device, fingerprint, code, targets, rotate, expires, problem}]}
 *   answer({id})                    → {kind, device, note}                     (one prompt)
 *   devices()                       → {devices: [{keyId, fingerprint, name, kind, addedSeq, revokedSeq, thisDevice, holdsMaster, masterIndex, mayKeepMaster, bot}]}
 *   rename({keyId, name})           → {}                                       (one prompt, naming the device and the new name)
 *   revoke({keyIds})                → {note}                                   (one prompt)
 *   scanDevice()                    → {link}                                   (opens the camera; one prompt, for the ticket)
 *   linkNext({link})                → {step: "ticket-sent", expires} | {step: "claimed", code, hint, canKeepMaster} | {step: "linked", keyId, seq, masterSent, note}
 *   linkConfirm({link, name?, keepMaster}) → {}                                (the person types the other device's code; a biometric of its own to send the master key)
 *   linkCancel({link})              → {}
 *   scanCode({prefix, title?})      → {text}                                   (the camera; rejects `Cancelled` or `CameraDenied`)
 *
 * Make, restore and replace the master key on the phone, with no computer (a step machine each,
 * `crates/phone-custody/src/steps.rs`; the screens and inputs are [IdentityStepsJson]'s):
 *
 *   startMake()                     → {flow, screen}   (first screen: show-words, or identity-ready for one made before and published now)
 *   startRestore()                  → {flow, screen}   (first screen: enter-words, purpose "restore")
 *   startRotate()                   → {flow, screen}   (first screen: enter-words, purpose "replace"; needs a joined phone)
 *   identityStep({flow, input})     → {screen, ended}  (rejects `WrongInput` and stays on the screen; any other refusal ends the flow)
 *   identityCancel({flow})          → {}               (wipes the words the flow holds)
 *   pendingIdentity()               → {did | null}     (an identity made here and not published yet; no network)
 *   finishPending()                 → {did | null}     (publishes it; `Unavailable` while the store does not answer)
 *   retryMasterPushes()             → {note | null}    (one prompt when an app is still to be sent the new master key)
 *   setSecure({on})                 → {}               (FLAG_SECURE on the window: no screenshots, no recents thumbnail)
 *
 * A start refuses `NoKeys`, `AlreadyJoined` (make, restore), `NoIdentity` (rotate) and
 * `NoBiometrics`, and asks the weak-protection question before any word exists when the Keystore
 * is not secure hardware (`WeakProtection` when declined). The master key is kept behind one
 * biometric prompt, at the step that keeps it, and it names what the key is about to do.
 *
 * Who may call: [CallerDocument] tracks which document real page loads brought in (never the
 * history address, which a script can rewrite), and everything that links, sends the
 * master key, renames, revokes or answers is the identity page's alone, and is checked again after every wait; reads of public state and the
 * sign-in are open to the app's other pages, and the sign-in is confirmed by the person each time.
 * The page cannot supply a scanned code or say the match codes agree. Making, restoring and
 * replacing, everything that touches the 12 words, and publishing what was made are the identity
 * page's alone; `pendingIdentity` only reads.
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
  private val prompt by lazy { ActionPrompt(context.applicationContext) { activity } }
  private val links = ConcurrentHashMap<String, Held>()
  /** The identity flows the page is in, by the id [startFlow] gave it. */
  private val flows = ConcurrentHashMap<String, IdentitySteps>()
  /** Which document is loaded, from real loads only. */
  private val document = CallerDocument()
  /** The ticket a camera call was admitted under, by its callback id, until the scan returns. */
  private val scanTickets = ConcurrentHashMap<String, CallerDocument.Ticket>()
  private val loads = object : WebViewListener() {
    // Raised on the main thread for a navigation that creates a document; not for pushState,
    // replaceState or a fragment change. The address is the entry being navigated to, read once
    // here, never when a call arrives.
    override fun onPageStarted(webView: WebView) {
      document.started(webView.url)
    }

    // Only the load `started` named finishes it; the address is compared, not trusted.
    override fun onPageLoaded(webView: WebView) {
      document.finished(webView.url)
    }
  }

  override fun load() {
    bridge?.addWebViewListener(loads)
  }
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
  fun status(call: PluginCall) = run(call, Caller.APP) {
    statusJson(keys().status())
  }

  @PluginMethod
  fun create(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    publicJson(keys().create()).put("protection", protection())
  }

  @PluginMethod
  fun join(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
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
  fun waitJoined(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
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

  /**
   * Signs a session for one address, after the person has confirmed it in a prompt that names the
   * address. A page of the app's own origin may ask (WE signs in at boot), but it is the person who
   * allows each signing: a script on the page cannot sign for an address behind their back.
   */
  @PluginMethod
  fun signSession(call: PluginCall) = run(call, Caller.APP) { ticket ->
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
    val origin = PromptText.originOf(request.url) ?: throw Refusal("Invalid", "url is not a web address")
    val words = PromptText.signIn(purpose == SessionPurpose.RENEW, origin)
    approve(words, ticket)
    JSObject(keys().signSession(request))
  }

  @PluginMethod
  fun identityStatus(call: PluginCall) = run(call, Caller.APP) {
    identityJson(identity().status()).put("biometrics", master.canAuthenticate())
  }

  /**
   * Takes the master key waiting in the inbox. A phone with no strong biometric is refused before
   * anything is read. A phone whose Keystore is not secure hardware (`software`, as on an
   * emulator) keeps it only once the person has agreed in [agreeToWeakProtection]; declining
   * leaves the key in the inbox, untaken.
   */
  @PluginMethod
  fun takeMaster(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) { ticket ->
    if (!master.canAuthenticate()) {
      throw Refusal("NoBiometrics", "Set up fingerprint or face unlock to keep the master key on this phone.")
    }
    val identity = identity()
    val taken = try {
      identity.takeMaster(false)
    } catch (e: PhoneKeyException.WeakProtection) {
      if (!agreeToWeakProtection() || !document.holds(ticket)) {
        throw Refusal("WeakProtection", e.message ?: "The master key wasn't kept on this phone.")
      }
      identity.takeMaster(true)
    }
    JSObject().put("taken", taken?.let(::takenJson) ?: JSONObject.NULL)
  }

  @PluginMethod
  fun askForMaster(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    askedJson(identity().askForMaster())
  }

  @PluginMethod
  fun masterWaiting(call: PluginCall) = run(call, Caller.APP) {
    JSObject().put("waiting", identity().masterWaiting())
  }

  @PluginMethod
  fun requests(call: PluginCall) = run(call, Caller.APP) {
    JSObject().put("requests", JSArray(identity().requests().map(::requestJson)))
  }

  @PluginMethod
  fun answer(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    val id = call.getString("id") ?: throw Refusal("Invalid", "answer needs the request's id")
    answerJson(identity().answer(id))
  }

  @PluginMethod
  fun devices(call: PluginCall) = run(call, Caller.APP) {
    JSObject().put("devices", JSArray(identity().devices().map(::deviceJson)))
  }

  @PluginMethod
  fun rename(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) { ticket ->
    val keyId = call.getString("keyId") ?: throw Refusal("Invalid", "rename needs the device's keyId")
    val name = call.getString("name")?.trim()?.takeIf { it.isNotEmpty() }
      ?: throw Refusal("Invalid", "Enter a name for the device.")
    val current = identity().devices().firstOrNull { it.keyId == keyId }?.name?.takeIf { it.isNotBlank() } ?: keyId
    approve(PromptText.rename(current, name), ticket)
    identity().rename(keyId, name)
    JSObject()
  }

  @PluginMethod
  fun revoke(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    val keyIds = call.getArray("keyIds")?.toList<String>()?.takeIf { it.isNotEmpty() }
      ?: throw Refusal("Invalid", "revoke needs the keyIds of the devices")
    JSObject().put("note", identity().revoke(keyIds) ?: JSONObject.NULL)
  }

  /**
   * Reads the code of the device to add from the camera, and starts linking it. The code never comes
   * from the page: a script that could hand one in could enrol a device of its own.
   */
  @PluginMethod
  fun scanDevice(call: PluginCall) {
    val ticket = callerTicket(call, Caller.IDENTITY_PAGE) ?: return
    scanTickets[call.callbackId] = ticket
    val intent = Intent(context, ScanActivity::class.java)
      .putExtra(ScanActivity.EXTRA_PREFIX, DEVICE_CODE_PREFIX)
      .putExtra(ScanActivity.EXTRA_TITLE, "Scan the code on the new device")
    startActivityForResult(call, intent, "deviceScanned")
  }

  @ActivityCallback
  private fun deviceScanned(call: PluginCall?, result: ActivityResult) {
    call ?: return
    val ticket = takeScanTicket(call) ?: return
    val text = result.data?.getStringExtra(ScanActivity.EXTRA_TEXT)
    if (text == null) {
      rejectScan(call, result)
      return
    }
    // Not run on the main thread: the ticket asks the store, and the master key asks the person.
    pool.execute {
      sweepLinks()
      try {
        val id = UUID.randomUUID().toString()
        val link = identity().scanDevice(text)
        if (!document.holds(ticket)) {
          link.cancel()
          link.close()
          throw Refusal("NotAllowed", "The page changed. Start again.")
        }
        links[id] = Held(link)
        call.resolve(JSObject().put("link", id))
      } catch (e: Exception) {
        rejectCall(call, e)
      }
    }
  }

  @PluginMethod
  fun linkNext(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    withLink(call) { id, held ->
      try {
        val step = held.link.next()
        if (step is LinkStep.Claimed) held.claim = step
        if (step is LinkStep.Linked && links.remove(id, held)) held.link.close()
        stepJson(step)
      } catch (e: Exception) {
        drop(id, held)
        throw e
      }
    }
  }

  /**
   * Adds the device. Two things are asked of the person here, in prompts the page cannot answer: the
   * code the other device shows, typed in and compared with the one this plugin derived from the
   * claim ([MatchCode]); and, when the master key goes with it, a biometric of its own that names the
   * device. Anything but both yes ends the link and adds nothing.
   */
  @PluginMethod
  fun linkConfirm(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) { ticket ->
    withLink(call) { id, held ->
      try {
        val claim = held.claim ?: throw Refusal("NotClaimed", "The other device hasn't answered yet.")
        val name = call.getString("name")?.trim()?.takeIf { it.isNotEmpty() }
        val keepMaster = call.getBoolean("keepMaster") ?: false
        val typed = askForMatchCode(claim.hint ?: name)
          ?: throw Refusal("Cancelled", "Nothing was added.")
        if (!MatchCode.matches(claim.code, typed)) {
          throw Refusal("Mismatch", "The codes didn't match, so nothing was added. Start again.")
        }
        stillHolds(ticket)
        if (keepMaster) {
          approve(PromptText.sendMaster(name ?: claim.hint ?: "the new device"), ticket, strongBiometricOnly = true)
        }
        stillHolds(ticket)
        held.link.confirm(name, keepMaster)
        JSObject()
      } catch (e: Exception) {
        drop(id, held)
        throw e
      }
    }
  }

  @PluginMethod
  fun linkCancel(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    val id = call.getString("link") ?: throw Refusal("Invalid", "linkCancel needs the link")
    // Removed and closed here: the entry does not wait for a linkNext that may never come.
    // A `next` in flight on it keeps the native link alive through its own Arc.
    links.remove(id)?.let { it.link.cancel(); it.link.close() }
    JSObject()
  }

  @PluginMethod
  fun startMake(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    startFlow(IdentityFlow.MAKE)
  }

  @PluginMethod
  fun startRestore(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    startFlow(IdentityFlow.RESTORE)
  }

  @PluginMethod
  fun startRotate(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    startFlow(IdentityFlow.ROTATE)
  }

  @PluginMethod
  fun identityStep(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    val input = try {
      IdentityStepsJson.inputOf(call.getObject("input"))
    } catch (e: IllegalArgumentException) {
      throw Refusal("Invalid", e.message ?: "the step needs its input")
    }
    val id = call.getString("flow") ?: throw Refusal("Invalid", "the step needs its flow")
    val flow = flows[id] ?: throw Refusal("Ended", "This step has ended. Start again.")
    try {
      val screen = flow.step(input)
      val ended = flow.ended()
      if (ended) endFlow(id, flow)
      JSObject().put("screen", IdentityStepsJson.screenJson(screen)).put("ended", ended)
    } catch (e: PhoneKeyException) {
      if (e !is PhoneKeyException.WrongInput) endFlow(id, flow)
      throw e
    }
  }

  @PluginMethod
  fun identityCancel(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    val id = call.getString("flow") ?: throw Refusal("Invalid", "identityCancel needs the flow")
    flows[id]?.let { endFlow(id, it) }
    JSObject()
  }

  @PluginMethod
  fun pendingIdentity(call: PluginCall) = run(call, Caller.APP) {
    JSObject().put("did", identity().pendingIdentity() ?: JSONObject.NULL)
  }

  @PluginMethod
  fun finishPending(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    JSObject().put("did", identity().finishPending() ?: JSONObject.NULL)
  }

  @PluginMethod
  fun retryMasterPushes(call: PluginCall) = run(call, Caller.IDENTITY_PAGE) {
    JSObject().put("note", identity().retryMasterPushes() ?: JSONObject.NULL)
  }

  /**
   * Marks the window secure (`on: true`) while words are on screen, and clears it: Android leaves
   * a secure window out of screenshots, screen recording and the recent-apps thumbnail. Answered
   * once the flag is set, on the main thread.
   */
  @PluginMethod
  fun setSecure(call: PluginCall) {
    callerTicket(call, Caller.IDENTITY_PAGE) ?: return
    val on = call.getBoolean("on")
    if (on == null) {
      call.reject("setSecure needs on: true or false", "Invalid")
      return
    }
    val host = activity
    if (host == null) {
      call.reject("the app has no window", "Unavailable")
      return
    }
    host.runOnUiThread {
      if (on) {
        host.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        host.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      call.resolve()
    }
  }

  /** Opens the camera on a QR code whose text starts with `prefix`; the text, uninterpreted. */
  @PluginMethod
  fun scanCode(call: PluginCall) {
    val ticket = callerTicket(call, Caller.IDENTITY_PAGE) ?: return
    val prefix = call.getString("prefix")
    if (prefix.isNullOrEmpty() || !prefix.startsWith("coasys:")) {
      call.reject("scanCode needs the prefix of the code it reads", "Invalid")
      return
    }
    val intent = Intent(context, ScanActivity::class.java)
      .putExtra(ScanActivity.EXTRA_PREFIX, prefix)
      .putExtra(ScanActivity.EXTRA_TITLE, call.getString("title"))
    scanTickets[call.callbackId] = ticket
    startActivityForResult(call, intent, "scanned")
  }

  @ActivityCallback
  private fun scanned(call: PluginCall?, result: ActivityResult) {
    call ?: return
    takeScanTicket(call) ?: return
    val text = result.data?.getStringExtra(ScanActivity.EXTRA_TEXT)
    if (text != null) call.resolve(JSObject().put("text", text)) else rejectScan(call, result)
  }

  private fun rejectScan(call: PluginCall, result: ActivityResult) {
    when (result.data?.getStringExtra(ScanActivity.EXTRA_REASON)) {
      "denied" -> call.reject("Allow camera access to scan, or paste the code.", "CameraDenied")
      "no-camera" -> call.reject("Can't start the camera. Paste the code instead.", "NoCamera")
      else -> call.reject("the scan was cancelled", "Cancelled")
    }
  }

  override fun handleOnDestroy() {
    bridge?.removeWebViewListener(loads)
    links.keys.toList().forEach { id -> links.remove(id)?.let { it.link.cancel(); it.link.close() } }
    flows.keys.toList().forEach { id -> flows[id]?.let { endFlow(id, it) } }
    super.handleOnDestroy()
  }

  private enum class IdentityFlow { MAKE, RESTORE, ROTATE }

  /**
   * Starts [kind] and answers its first screen with the flow's id. The protection question is
   * asked here, before any word is made or typed: a phone with no strong biometric is refused, and
   * one whose Keystore is software only goes on once the person has agreed.
   */
  private fun startFlow(kind: IdentityFlow): JSObject {
    if (!master.canAuthenticate()) {
      throw Refusal("NoBiometrics", "Set up fingerprint or face unlock to keep the master key on this phone.")
    }
    val identity = identity()
    val start = { weak: Boolean ->
      when (kind) {
        IdentityFlow.MAKE -> identity.startMake(weak)
        IdentityFlow.RESTORE -> identity.startRestore(weak)
        IdentityFlow.ROTATE -> identity.startRotate(weak)
      }
    }
    val flow = try {
      start(false)
    } catch (e: PhoneKeyException.WeakProtection) {
      if (!agreeToWeakProtection()) {
        throw Refusal("WeakProtection", e.message ?: "The master key wasn't kept on this phone.")
      }
      start(true)
    }
    val id = UUID.randomUUID().toString()
    flows[id] = flow
    try {
      val screen = flow.next()
      val ended = flow.ended()
      if (ended) endFlow(id, flow)
      return JSObject()
        .put("flow", id)
        .put("screen", IdentityStepsJson.screenJson(screen))
        .put("ended", ended)
    } catch (e: Exception) {
      endFlow(id, flow)
      throw e
    }
  }

  /** Removes the flow, cancels it (its thread wipes what it holds) and frees the native handle. */
  private fun endFlow(id: String, flow: IdentitySteps) {
    if (flows.remove(id, flow)) {
      flow.cancel()
      flow.close()
    }
  }

  /**
   * Runs [block] with the call's link, the id marked in use so [sweepLinks] — which runs on
   * every plugin call — cannot close the link under it.
   */
  private fun <T> withLink(call: PluginCall, block: (String, Held) -> T): T {
    val id = call.getString("link") ?: throw Refusal("Invalid", "the call needs the link")
    inUse.add(id)
    try {
      val held = links[id] ?: throw Refusal("Ended", "This link has ended. Start again.")
      return block(id, held)
    } finally {
      inUse.remove(id)
    }
  }

  /** Ends a link that is not going on: out of the map, cancelled and closed. */
  private fun drop(id: String, held: Held) {
    if (links.remove(id, held)) {
      held.link.cancel()
      held.link.close()
    }
  }

  /**
   * Removes and closes the links whose native side ended — expired, errored, cancelled or
   * linked — whether or not a `linkNext` ever polled the end. One pass over the map on each
   * plugin call keeps the map to links that are live.
   */
  private fun sweepLinks() {
    for ((id, held) in links) {
      if (held.link.ended() && !inUse.contains(id) && links.remove(id, held)) {
        held.link.close()
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

  /**
   * Runs [body] off the main thread and answers [call] with what it returned, or why not. The
   * document the call comes from is checked first, here on the bridge's thread before the hop to the
   * pool (the nearest point to the call's arrival a plugin can reach), against what [access] allows,
   * and the ticket it is admitted under is handed to [body] for the checks after each wait.
   */
  private fun run(call: PluginCall, access: Caller, body: (CallerDocument.Ticket) -> JSObject) {
    val ticket = try {
      requireCaller(access)
    } catch (e: Exception) {
      rejectCall(call, e)
      return
    }
    pool.execute {
      try {
        sweepLinks()
        val out = body(ticket)
        stillHolds(ticket)
        call.resolve(out)
      } catch (e: Exception) {
        rejectCall(call, e)
      }
    }
  }

  /** Rejects [call] with the code its failure carries. */
  private fun rejectCall(call: PluginCall, e: Exception) {
    when (e) {
      is Refusal -> call.reject(e.message, e.code)
      is PromptUnavailable -> call.reject(e.message, "NoBiometrics")
      is PhoneKeyException -> call.reject(e.message ?: e.javaClass.simpleName, e.javaClass.simpleName)
      is SealException -> call.reject(e.message ?: "the Keystore refused", "Sealer")
      else -> call.reject(e.message ?: e.javaClass.simpleName, "Failed", e)
    }
  }

  /** Which pages a method answers. */
  private enum class Caller {
    /** The identity page alone: everything that signs for the person's identity, links, sends the master key or changes a device. */
    IDENTITY_PAGE,

    /** Any page of the app: reads of public state, and the sign-in, which the person confirms. */
    APP,
  }

  /**
   * Admits the call against the document real loads brought in, never the history address; refuses
   * with `NotAllowed` otherwise. The ticket is what a wait checks again with [stillHolds]. Capacitor
   * only passes a call to a plugin from the main frame of the page (`MessageHandler`'s
   * `isMainFrame` check), so a frame cannot call as the identity page; the legacy bridge has no such
   * check and is refused here.
   */
  private fun requireCaller(access: Caller): CallerDocument.Ticket {
    if (bridge?.config?.isUsingLegacyBridge != false) throw Refusal("NotAllowed", "This page can't use the device key.")
    return document.admit(identityOnly = access == Caller.IDENTITY_PAGE)
      ?: throw Refusal("NotAllowed", "This page can't use the device key.")
  }

  /** Refuses when a new document has loaded since the call was admitted: nothing is mutated or signed for it. */
  private fun stillHolds(ticket: CallerDocument.Ticket) {
    if (!document.holds(ticket)) throw Refusal("NotAllowed", "The page changed. Start again.")
  }

  /** For a method that answers later (the camera): the ticket, or null with the call rejected when the page is not allowed. */
  private fun callerTicket(call: PluginCall, access: Caller): CallerDocument.Ticket? {
    val ticket = try {
      requireCaller(access)
    } catch (e: Refusal) {
      call.reject(e.message, e.code)
      return null
    }
    return ticket
  }

  /** The ticket a camera call left; null, with the call rejected, if there is none or the document changed while the camera was open. */
  private fun takeScanTicket(call: PluginCall): CallerDocument.Ticket? {
    val ticket = scanTickets.remove(call.callbackId)
    if (ticket == null || !document.holds(ticket)) {
      call.reject("The page changed. Start again.", "NotAllowed")
      return null
    }
    return ticket
  }

  /**
   * The person's yes to [words], in a prompt that shows them; a no ends the call as `Cancelled`. The
   * document is checked again after the wait, so a page that loaded meanwhile gets nothing signed.
   */
  private fun approve(words: PromptText.Words, ticket: CallerDocument.Ticket, strongBiometricOnly: Boolean = false) {
    if (!prompt.confirm(words.title, words.description, strongBiometricOnly)) {
      throw Refusal("Cancelled", "Cancelled.")
    }
    stillHolds(ticket)
  }

  /**
   * Asks for the code the other device shows, in a dialog of the app's own; null when closed without
   * one. What is typed is compared with [MatchCode], not by the page.
   */
  private fun askForMatchCode(device: String?): String? {
    val host = activity ?: throw Refusal("Unavailable", "The app isn't on screen to ask.")
    val typed = java.util.concurrent.atomic.AtomicReference<String?>(null)
    val answered = CountDownLatch(1)
    host.runOnUiThread {
      val field = android.widget.EditText(host).apply {
        hint = "Code"
        inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        isSingleLine = true
      }
      val who = device?.let { PromptText.plain(it) }?.takeIf { it.isNotEmpty() } ?: "the other device"
      AlertDialog.Builder(host)
        .setTitle("Type the code from $who")
        .setMessage("Type the code it shows. They must be the same.")
        .setView(field)
        .setPositiveButton("Check") { _, _ -> typed.set(field.text.toString()) }
        .setNegativeButton("Cancel", null)
        .setOnDismissListener { answered.countDown() }
        .show()
    }
    answered.await()
    return typed.get()
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

  /** A link this phone runs, with the claim the other device made on it, once it has. */
  private class Held(val link: HolderLink) {
    @Volatile var claim: LinkStep.Claimed? = null
  }

  companion object {
    /** The store holds a `state` answer at most 8 seconds. */
    private const val STATE_WAIT_SECONDS = 8L

    /** What the code of a device to add starts with. */
    private const val DEVICE_CODE_PREFIX = "coasys:device:1:"

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
