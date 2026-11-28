package org.coasys.app.devicekey

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.we_phone_custody.DeviceKeys
import uniffi.we_phone_custody.PhoneKeyException
import uniffi.we_phone_custody.SealException

/**
 * The Keystore key and the sealer on a phone (or the emulator): the key is made with the policy
 * the plugin relies on, never exportable, and seeds sealed under it open only under their label.
 * Then the Rust library, loaded from the APK's jniLibs, makes keys sealed by it.
 */
@RunWith(AndroidJUnit4::class)
class KeystoreSealerTest {
  private val context = InstrumentationRegistry.getInstrumentation().targetContext

  @Test
  fun theKeystoreKeyIsHardwareBackedAndNotExportable() {
    val key = KeystoreKey.getOrCreate()
    // The Keystore hands out a handle, never the key's bytes.
    assertEquals(null, key.encoded)
    assertEquals("AES", key.algorithm)
    val protection = KeystoreKey.protectionOf(key)
    assertTrue(
      "protection $protection",
      protection == KeystoreKey.Protection.TEE || protection == KeystoreKey.Protection.STRONGBOX ||
        // An emulator without a hardware Keystore reports software; a phone never should.
        isEmulator(),
    )
    assertEquals(key, KeystoreKey.getOrCreate())
    assertTrue(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(KeystoreKey.ALIAS))
  }

  @Test
  fun sealedUnderTheKeystoreKeyAndOpenedOnlyUnderItsLabel() {
    val sealer = AesGcmSealer { KeystoreKey.getOrCreate() }
    val seed = ByteArray(32) { (it * 7).toByte() }
    val sealed = sealer.seal("coasys:phone-seed:sign:1", seed.copyOf())
    val again = sealer.seal("coasys:phone-seed:sign:1", seed.copyOf())
    assertNotEquals("a fresh IV each time", sealed.toList(), again.toList())
    assertArrayEquals(seed, sealer.open("coasys:phone-seed:sign:1", sealed))
    assertThrows(SealException::class.java) { sealer.open("coasys:phone-seed:enc:1", sealed) }
    sealer.wipe()
  }

  @Test
  fun theRustLibraryMakesKeysSealedByTheKeystore() {
    val dir = File(context.cacheDir, "device-keys-test").apply { deleteRecursively(); mkdirs() }
    try {
      val sealer = AesGcmSealer { KeystoreKey.getOrCreate() }
      val keys = DeviceKeys.open(dir.absolutePath, sealer)
      val made = keys.create()
      assertTrue(made.sign.startsWith("z6Mk"))
      assertEquals(made, DeviceKeys.open(dir.absolutePath, sealer).status().keys)
      assertThrows(PhoneKeyException.KeysExist::class.java) { keys.create() }
      assertEquals(0, sealer.keptForWipe())
    } finally {
      dir.deleteRecursively()
    }
  }

  private fun isEmulator(): Boolean =
    android.os.Build.FINGERPRINT.contains("generic") || android.os.Build.HARDWARE.contains("ranchu")
}
