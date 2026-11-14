package org.coasys.app.devicekey

import java.io.File
import java.math.BigInteger
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import uniffi.we_phone_custody.ClaimProgress
import uniffi.we_phone_custody.DeviceKeys
import uniffi.we_phone_custody.PhoneKeyException
import uniffi.we_phone_custody.SealException
import uniffi.we_phone_custody.SessionPurpose
import uniffi.we_phone_custody.SessionRequest

/**
 * The plugin's sealer and the Rust it is handed to, on the JVM: the real `we_phone_custody`
 * library (its host build, `build/host-lib`), through the same uniffi bindings the app uses, with
 * a software AES key in place of the Keystore's. The Keystore itself is the instrumented test's
 * (`src/androidTest`).
 */
class DeviceKeysJvmTest {
  private lateinit var dir: File
  private lateinit var key: SecretKey

  @Before
  fun setUp() {
    dir = Files.createTempDirectory("device-keys").toFile()
    key = aesKey()
  }

  @After
  fun tearDown() {
    dir.deleteRecursively()
  }

  @Test
  fun aSealedSeedOpensOnlyUnderItsOwnLabelAndUntampered() {
    val sealer = AesGcmSealer { key }
    val seed = ByteArray(32) { it.toByte() }
    val sealed = sealer.seal(SIGN, seed.copyOf())
    assertEquals(1 + 12 + 32 + 16, sealed.size)
    assertEquals(1.toByte(), sealed[0])

    assertArrayEquals(seed, sealer.open(SIGN, sealed))
    assertThrows(SealException::class.java) { sealer.open(ENC, sealed) }
    val tampered = sealed.copyOf().also { it[20] = (it[20].toInt() xor 1).toByte() }
    assertThrows(SealException::class.java) { sealer.open(SIGN, tampered) }
    assertThrows(SealException::class.java) { sealer.open(SIGN, ByteArray(10)) }
  }

  @Test
  fun sealZeroesItsPlaintextAndWipeZeroesWhatOpenHandedOut() {
    val sealer = AesGcmSealer { key }
    val seed = ByteArray(32) { (it + 1).toByte() }
    val sealed = sealer.seal(SIGN, seed)
    assertTrue("seal zeroes the plaintext it took", seed.all { it == 0.toByte() })

    val opened = sealer.open(SIGN, sealed)
    assertFalse(opened.all { it == 0.toByte() })
    assertEquals(1, sealer.keptForWipe())
    sealer.wipe()
    assertTrue("wipe zeroes the plaintext open returned", opened.all { it == 0.toByte() })
    assertEquals(0, sealer.keptForWipe())
  }

  @Test
  fun createJoinAndSignThroughTheBindingsWipingEverySeedItOpens() {
    val sealer = AesGcmSealer { key }
    val keys = DeviceKeys.open(dir.absolutePath, sealer)
    val made = keys.create()
    assertTrue(made.sign.startsWith("z6Mk"))
    assertTrue(made.enc.startsWith("z6LS"))
    assertEquals("did:key:${made.sign}", made.didKey)

    // The key file: the public keys and the two sealed seeds.
    val file = JSONObject(File(dir, "device-keys.json").readText())
    assertEquals(made.sign, file.getString("sign"))
    assertEquals(made.enc, file.getString("enc"))
    assertEquals(1.toByte(), Base64.getDecoder().decode(file.getString("sealedSign"))[0])
    assertNotEquals(file.getString("sealedSign"), file.getString("sealedEnc"))

    // No identity yet: nothing to sign as, and no seed opened to find that out.
    assertThrows(PhoneKeyException.NoIdentity::class.java) { keys.signSession(login()) }
    assertEquals(0, sealer.keptForWipe())

    // A claim opens the device key once, and the Rust wipes it as soon as the claim is signed.
    val offer = offerString(STORE)
    val prepared = keys.prepareClaim("https://id.coasys.org/o#${offer.text}", "Test phone")
    assertEquals(0, sealer.keptForWipe())
    assertEquals("did:scid:coasys:1:${offer.scid}", prepared.did)
    assertEquals("$STORE/v1/offers/${offer.scid}/${offer.offerId}/claim", prepared.claimUrl)
    assertEquals(
      "$STORE/v1/offers/${offer.scid}/${offer.offerId}/state?key=${made.sign}",
      prepared.stateUrl,
    )
    val claim = JSONObject(prepared.body)
    assertEquals(made.sign, claim.getString("deviceKey"))
    assertEquals(made.enc, claim.getString("encKey"))
    assertEquals(prepared.stateUrl, keys.status().pending!!.stateUrl)

    // The store's answers, as the plugin hands them over.
    assertEquals(
      ClaimProgress.Waiting("claimed"),
      keys.claimAnswer(201u, """{"state":"claimed","kind":"node","expires":1}"""),
    )
    assertEquals(ClaimProgress.Waiting("unreachable-or-busy").javaClass,
      keys.claimAnswer(503u, "").javaClass)
    val joined = keys.claimAnswer(200u, """{"state":"spent","seq":4}""") as ClaimProgress.Joined
    assertEquals(offer.scid, joined.member.scid)
    assertEquals(4uL, joined.member.seq)
    assertNull(keys.status().pending)

    // Signed in as the identity, by the device key, for the origin dialed.
    val proof = JSONObject(keys.signSession(login()))
    val statement = proof.getJSONObject("statement")
    assertEquals("login", statement.getString("purpose"))
    assertEquals("did:scid:coasys:1:${offer.scid}", statement.getString("scid"))
    assertEquals(made.sign, statement.getString("key"))
    assertEquals("https://ad4m.example.org", statement.getString("audience"))
    assertEquals("native", statement.getJSONObject("client").getString("kind"))
    assertFalse(statement.has("grant"))
    assertTrue(proof.getString("sig").startsWith("z"))
    assertEquals(0, sealer.keptForWipe())

    // Joined once is joined: a second claim is refused, as is a second create.
    assertThrows(PhoneKeyException.AlreadyJoined::class.java) {
      keys.prepareClaim(offerString(STORE).text, null)
    }
    assertThrows(PhoneKeyException.KeysExist::class.java) { keys.create() }

    // Reopened, the file is the same phone.
    val reopened = DeviceKeys.open(dir.absolutePath, AesGcmSealer { key })
    assertEquals(made, reopened.status().keys)
    assertEquals(joined.member, reopened.status().identity)
  }

  @Test
  fun seedsSealedByOneKeystoreKeyDoNotOpenUnderAnother() {
    val keys = DeviceKeys.open(dir.absolutePath, AesGcmSealer { key })
    keys.create()
    val elsewhere = DeviceKeys.open(dir.absolutePath, AesGcmSealer { aesKey() })
    // Opening the file reads only the public keys; the first use of a seed is what fails.
    assertEquals(keys.status().keys, elsewhere.status().keys)
    val e = assertThrows(PhoneKeyException.Sealer::class.java) {
      elsewhere.prepareClaim(offerString(STORE).text, null)
    }
    assertTrue(e.message!!, e.message!!.contains("AEADBadTagException"))
    assertNull(elsewhere.status().pending)
  }

  private fun login() = SessionRequest(
    purpose = SessionPurpose.LOGIN,
    executor = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    url = "wss://AD4M.example.org:443/api/v1/ws",
    challenge = b64url(ByteArray(32) { 3 }),
    grant = null,
  )

  private class Offer(val text: String, val scid: String, val offerId: String)

  /** A well-formed `coasys:offer:1:` string, as a custody holder makes one. */
  private fun offerString(store: String): Offer {
    val random = java.security.SecureRandom()
    val digest = MessageDigest.getInstance("SHA-256").digest(ByteArray(16).also(random::nextBytes))
    val scid = base58(byteArrayOf(0x12, 0x20) + digest)
    val offerId = base58(ByteArray(16).also(random::nextBytes))
    val s = base58(ByteArray(32).also(random::nextBytes))
    // JCS: keys sorted, no whitespace; the values here need no escaping.
    val json = """{"offerId":"$offerId","s":"$s","scid":"$scid","store":"$store"}"""
    return Offer("coasys:offer:1:" + base58(json.toByteArray()), scid, offerId)
  }

  companion object {
    const val SIGN = "coasys:phone-seed:sign:1"
    const val ENC = "coasys:phone-seed:enc:1"
    const val STORE = "https://identity.example.org"
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    fun aesKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    fun b64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun base58(bytes: ByteArray): String {
      var n = BigInteger(1, bytes)
      val out = StringBuilder()
      val base = BigInteger.valueOf(58)
      while (n.signum() > 0) {
        val (q, r) = n.divideAndRemainder(base)
        out.append(ALPHABET[r.toInt()])
        n = q
      }
      bytes.takeWhile { it == 0.toByte() }.forEach { _ -> out.append('1') }
      return out.reverse().toString()
    }
  }
}
