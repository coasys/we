package org.coasys.app.devicekey

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The Keystore key that seals a master key's seed: AES-256-GCM, never exportable, usable only
 * after the person's strong biometric, once per use. `setUserAuthenticationRequired(true)` with an
 * auth timeout of 0 means every cipher must come through `BiometricPrompt` as a `CryptoObject`;
 * `setInvalidatedByBiometricEnrollment(true)` means a fingerprint or face enrolled later destroys
 * the key, so a person who adds a biometric to an unlocked phone does not get the master key with
 * it ([BiometricMasterSealer] reports that as `Invalidated`).
 *
 * StrongBox is preferred, as for [KeystoreKey]; without it the key is at the level AndroidKeyStore
 * gives, which [KeystoreKey.protectionOf] reports. The Rust side keeps a master key only at
 * `strongbox` or `tee`, unless the person agreed to the level the phone has.
 *
 * This is a different key from [KeystoreKey]'s, which needs no user authentication: a key login
 * never prompts, and that key never opens a master seed.
 */
object MasterKeystoreKey {
  const val ALIAS = "org.coasys.app.master-seeds.v1"
  private const val PROVIDER = "AndroidKeyStore"

  private fun store(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  fun existing(): SecretKey? = store().getKey(ALIAS, null) as SecretKey?

  /**
   * The key, made now when there is none. Making it needs a strong biometric enrolled: the
   * Keystore refuses an auth-per-use key otherwise (the caller checks first).
   */
  fun getOrCreate(): SecretKey = existing() ?: create()

  /** Forgets the key: only after a new enrolment invalidated it, so the next seal makes a new one. */
  fun delete() {
    store().deleteEntry(ALIAS)
  }

  private fun create(): SecretKey {
    return try {
      generate(strongBox = true)
    } catch (_: StrongBoxUnavailableException) {
      generate(strongBox = false)
    }
  }

  private fun generate(strongBox: Boolean): SecretKey {
    val spec = KeyGenParameterSpec.Builder(
      ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setKeySize(256)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .setUserAuthenticationRequired(true)
      .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      .setInvalidatedByBiometricEnrollment(true)
      .setIsStrongBoxBacked(strongBox)
      .build()
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    generator.init(spec)
    return generator.generateKey()
  }
}
