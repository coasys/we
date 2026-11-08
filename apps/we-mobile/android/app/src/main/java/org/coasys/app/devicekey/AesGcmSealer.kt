package org.coasys.app.devicekey

import java.nio.ByteBuffer
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import uniffi.we_phone_custody.SealException
import uniffi.we_phone_custody.Sealer

/**
 * Seals the phone's seeds with AES-256-GCM under [key], the label as associated data, so a seed
 * sealed for one slot does not open in the other. On the phone the key is the Keystore's
 * ([KeystoreKey]), which never leaves the secure hardware; the cipher runs there and only the
 * plaintext comes back.
 *
 * The sealed form is `0x01 ‖ iv (12 bytes) ‖ ciphertext ‖ tag (16 bytes)`. The IV is the
 * cipher's own (the Keystore refuses a caller's IV for encryption, which is what rules out reuse).
 *
 * Every plaintext [open] returns is kept until [wipe], which zeroes it: the Rust side calls
 * `wipe` as soon as it has copied the seed out, so the JVM's copy does not wait for a collector.
 * The plaintext [seal] receives is zeroed once it is encrypted.
 */
class AesGcmSealer(private val key: () -> SecretKey) : Sealer {
  private val handedOut = mutableListOf<ByteArray>()

  override fun seal(label: String, plaintext: ByteArray): ByteArray {
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key())
      cipher.updateAAD(label.toByteArray(Charsets.UTF_8))
      val sealed = cipher.doFinal(plaintext)
      val iv = cipher.iv
      if (iv.size != IV_BYTES) throw SealException.Failed("the cipher chose a ${iv.size}-byte IV")
      return ByteBuffer.allocate(1 + IV_BYTES + sealed.size)
        .put(VERSION)
        .put(iv)
        .put(sealed)
        .array()
    } catch (e: SealException) {
      throw e
    } catch (e: Exception) {
      throw SealException.Failed(describe(e))
    } finally {
      plaintext.fill(0)
    }
  }

  override fun open(label: String, sealed: ByteArray): ByteArray {
    if (sealed.size < 1 + IV_BYTES + TAG_BYTES || sealed[0] != VERSION) {
      throw SealException.Failed("not a sealed seed")
    }
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        GCMParameterSpec(TAG_BYTES * 8, sealed, 1, IV_BYTES),
      )
      cipher.updateAAD(label.toByteArray(Charsets.UTF_8))
      val plain = cipher.doFinal(sealed, 1 + IV_BYTES, sealed.size - 1 - IV_BYTES)
      synchronized(handedOut) { handedOut.add(plain) }
      return plain
    } catch (e: Exception) {
      throw SealException.Failed(describe(e))
    }
  }

  override fun wipe() {
    synchronized(handedOut) {
      handedOut.forEach { it.fill(0) }
      handedOut.clear()
    }
  }

  /** How many plaintexts are waiting for [wipe]: for the tests. */
  internal fun keptForWipe(): Int = synchronized(handedOut) { handedOut.size }

  private fun describe(e: Exception): String = "${e.javaClass.simpleName}: ${e.message ?: "no detail"}"

  companion object {
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val VERSION: Byte = 1
    const val IV_BYTES = 12
    const val TAG_BYTES = 16
  }
}
