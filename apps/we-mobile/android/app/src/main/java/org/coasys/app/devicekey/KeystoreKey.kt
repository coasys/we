package org.coasys.app.devicekey

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/**
 * The Keystore key that seals the device key's and the enc key's seeds: AES-256-GCM, never
 * exportable. StrongBox is preferred; without it the key is at whatever level AndroidKeyStore
 * gives (the TEE on a phone with a hardware Keystore, software on an emulator), every level is
 * accepted, and [protectionOf] reports the one it has. The seeds it seals are software keys made
 * in Rust; only this key can be in secure hardware. It needs no user
 * authentication (`setUserAuthenticationRequired(false)`): the phone signs its logins without
 * asking, as a computer's executor does with its own key. The master key, when phase 2b lets a
 * phone keep one, is sealed by a different, biometric-gated key; this one never opens it.
 */
object KeystoreKey {
  const val ALIAS = "org.coasys.app.device-seeds.v1"
  private const val PROVIDER = "AndroidKeyStore"

  /** Where the key lives, in the words the plugin reports. */
  enum class Protection(val word: String) {
    STRONGBOX("strongbox"),
    TEE("tee"),
    SOFTWARE("software"),
    UNKNOWN("unknown"),
  }

  private fun store(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  /** The key, when it has been made. */
  fun existing(): SecretKey? = store().getKey(ALIAS, null) as SecretKey?

  /**
   * The key, made now when there is none: in StrongBox when the phone has one, else at the
   * Keystore's default level, which may be software. See [protectionOf].
   */
  fun getOrCreate(): SecretKey = existing() ?: create()

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
      .setUserAuthenticationRequired(false)
      .setIsStrongBoxBacked(strongBox)
      .build()
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    generator.init(spec)
    return generator.generateKey()
  }

  /** Where [key] is kept, as the Keystore reports it. */
  fun protectionOf(key: SecretKey): Protection {
    val info = SecretKeyFactory.getInstance(key.algorithm, PROVIDER)
      .getKeySpec(key, KeyInfo::class.java) as KeyInfo
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> Protection.STRONGBOX
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> Protection.TEE
        KeyProperties.SECURITY_LEVEL_SOFTWARE -> Protection.SOFTWARE
        else -> Protection.UNKNOWN
      }
    }
    @Suppress("DEPRECATION")
    return if (info.isInsideSecureHardware) Protection.TEE else Protection.SOFTWARE
  }
}
