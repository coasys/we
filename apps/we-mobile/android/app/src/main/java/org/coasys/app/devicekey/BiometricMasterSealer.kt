package org.coasys.app.devicekey

import android.app.Activity
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import android.security.keystore.KeyPermanentlyInvalidatedException
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import uniffi.we_phone_custody.MasterSealException
import uniffi.we_phone_custody.MasterSealer

/**
 * Seals and opens a master key's seed under [MasterKeystoreKey], one `BiometricPrompt` per use.
 *
 * The Rust side calls [seal] and [open] on a worker thread (never the main one). Each call makes a
 * cipher over the Keystore key, shows the prompt on the main thread with that cipher as its
 * `CryptoObject`, and waits; the Keystore unlocks that one cipher for that one operation when the
 * person's strong biometric matches, and the seal or open runs on it with the label as associated
 * data. The prompt's title is the sentence the Rust side passes, which says what the master key is
 * about to do ("Confirm it's you to link a device").
 *
 * The prompt is the framework's (`android.hardware.biometrics`, API 30 and up, the app's floor),
 * so it needs no AndroidX library and no `FragmentActivity`.
 *
 * The sealed form is [AesGcmSealer]'s: `0x01 ‖ iv (12 bytes) ‖ ciphertext ‖ tag (16 bytes)`.
 * As there, [open]'s plaintexts are kept until [wipe] zeroes them, and [seal]'s plaintext is
 * zeroed once it is encrypted.
 */
class BiometricMasterSealer(
  private val context: Context,
  private val activity: () -> Activity?,
) : MasterSealer {
  private val handedOut = mutableListOf<ByteArray>()

  /** Whether a strong biometric is enrolled, which the key needs to be made or used. */
  fun canAuthenticate(): Boolean =
    context.getSystemService(BiometricManager::class.java)
      ?.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

  override fun protection(): String {
    return try {
      val key = MasterKeystoreKey.existing()
        ?: if (canAuthenticate()) MasterKeystoreKey.getOrCreate() else return "none"
      KeystoreKey.protectionOf(key).word
    } catch (e: Exception) {
      "unknown"
    }
  }

  override fun seal(label: String, plaintext: ByteArray, prompt: String): ByteArray {
    try {
      if (!canAuthenticate()) throw MasterSealException.NoBiometrics()
      val cipher = encryptCipher()
      val unlocked = authenticate(cipher, prompt)
      unlocked.updateAAD(label.toByteArray(Charsets.UTF_8))
      val sealed = unlocked.doFinal(plaintext)
      val iv = unlocked.iv
      if (iv.size != AesGcmSealer.IV_BYTES) {
        throw MasterSealException.Failed("the cipher chose a ${iv.size}-byte IV")
      }
      return ByteBuffer.allocate(1 + iv.size + sealed.size)
        .put(AesGcmSealer.VERSION)
        .put(iv)
        .put(sealed)
        .array()
    } catch (e: MasterSealException) {
      throw e
    } catch (e: Exception) {
      throw MasterSealException.Failed(describe(e))
    } finally {
      plaintext.fill(0)
    }
  }

  override fun open(label: String, sealed: ByteArray, prompt: String): ByteArray {
    val header = 1 + AesGcmSealer.IV_BYTES
    if (sealed.size < header + AesGcmSealer.TAG_BYTES || sealed[0] != AesGcmSealer.VERSION) {
      throw MasterSealException.Failed("not a sealed master key")
    }
    try {
      if (!canAuthenticate()) throw MasterSealException.NoBiometrics()
      val key = MasterKeystoreKey.existing() ?: throw MasterSealException.Invalidated()
      val cipher = Cipher.getInstance(AesGcmSealer.TRANSFORMATION)
      try {
        cipher.init(
          Cipher.DECRYPT_MODE,
          key,
          GCMParameterSpec(AesGcmSealer.TAG_BYTES * 8, sealed, 1, AesGcmSealer.IV_BYTES),
        )
      } catch (_: KeyPermanentlyInvalidatedException) {
        throw MasterSealException.Invalidated()
      }
      val unlocked = authenticate(cipher, prompt)
      unlocked.updateAAD(label.toByteArray(Charsets.UTF_8))
      val plain = try {
        unlocked.doFinal(sealed, header, sealed.size - header)
      } catch (_: AEADBadTagException) {
        throw MasterSealException.Failed("the sealed master key does not open under this label")
      }
      synchronized(handedOut) { handedOut.add(plain) }
      return plain
    } catch (e: MasterSealException) {
      throw e
    } catch (e: Exception) {
      throw MasterSealException.Failed(describe(e))
    }
  }

  override fun wipe() {
    synchronized(handedOut) {
      handedOut.forEach { it.fill(0) }
      handedOut.clear()
    }
  }

  /**
   * A cipher to seal with. A key a new enrolment invalidated cannot seal again, and what it sealed
   * cannot open any more either: it is forgotten and a new key made, and the new seal is under it.
   */
  private fun encryptCipher(): Cipher {
    val cipher = Cipher.getInstance(AesGcmSealer.TRANSFORMATION)
    try {
      cipher.init(Cipher.ENCRYPT_MODE, MasterKeystoreKey.getOrCreate())
    } catch (_: KeyPermanentlyInvalidatedException) {
      MasterKeystoreKey.delete()
      cipher.init(Cipher.ENCRYPT_MODE, MasterKeystoreKey.getOrCreate())
    }
    return cipher
  }

  /**
   * Shows the prompt for [cipher] and waits for the person: the unlocked cipher, or why not. A
   * finger that does not match leaves the prompt up for another try; the prompt is closed after
   * [WAIT_MINUTES] with no answer.
   */
  private fun authenticate(cipher: Cipher, title: String): Cipher {
    val host = activity() ?: throw MasterSealException.Failed("the app is not on screen to ask")
    val done = CountDownLatch(1)
    val unlocked = AtomicReference<Cipher?>(null)
    val failure = AtomicReference<MasterSealException?>(null)
    val cancel = CancellationSignal()
    host.runOnUiThread {
      try {
        val prompt = BiometricPrompt.Builder(host)
          .setTitle(title)
          .setAllowedAuthenticators(BIOMETRIC_STRONG)
          .setConfirmationRequired(true)
          .setNegativeButton("Cancel", host.mainExecutor) { _, _ ->
            failure.set(MasterSealException.Cancelled())
            done.countDown()
          }
          .build()
        prompt.authenticate(
          BiometricPrompt.CryptoObject(cipher),
          cancel,
          host.mainExecutor,
          object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              unlocked.set(result.cryptoObject?.cipher)
              done.countDown()
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) {
              failure.set(promptError(code, message))
              done.countDown()
            }
          },
        )
      } catch (e: Exception) {
        failure.set(MasterSealException.Failed(describe(e)))
        done.countDown()
      }
    }
    if (!done.await(WAIT_MINUTES, TimeUnit.MINUTES)) {
      cancel.cancel()
      done.await(5, TimeUnit.SECONDS)
      throw MasterSealException.Cancelled()
    }
    failure.get()?.let { throw it }
    return unlocked.get() ?: throw MasterSealException.Failed("the prompt answered without a cipher")
  }

  private fun promptError(code: Int, message: CharSequence): MasterSealException = when (code) {
    BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED,
    BiometricPrompt.BIOMETRIC_ERROR_CANCELED,
    BiometricPrompt.BIOMETRIC_ERROR_TIMEOUT,
    -> MasterSealException.Cancelled()
    BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS,
    BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT,
    BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL,
    -> MasterSealException.NoBiometrics()
    else -> MasterSealException.Failed("the biometric prompt ended: $message ($code)")
  }

  private fun describe(e: Exception): String = "${e.javaClass.simpleName}: ${e.message ?: "no detail"}"

  /** How many plaintexts are waiting for [wipe]: for the tests. */
  internal fun keptForWipe(): Int = synchronized(handedOut) { handedOut.size }

  private companion object {
    const val WAIT_MINUTES = 3L
  }
}
