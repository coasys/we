package org.coasys.app.devicekey

import android.app.Activity
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
import android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** The phone cannot ask: no screen lock or biometric is set up, or the app is not on screen. */
class PromptUnavailable(message: String) : Exception(message)

/**
 * A prompt that says what it is for, and that the person answers with a fingerprint, a face or the
 * screen lock. Unlike the master key's prompt it opens no key: it is the person's yes to one named
 * action ("Sign in to host.example", "Send your master key to Work laptop"), so a script that can
 * call the plugin still cannot act without the person seeing what is being done.
 *
 * The prompt is the framework's (`android.hardware.biometrics`, API 30 and up, the app's floor).
 */
class ActionPrompt(
  private val context: Context,
  private val activity: () -> Activity?,
) {
  /**
   * Shows [title] and [description] and waits for the person: true when they confirmed, false when
   * they cancelled or the prompt timed out. With [strongBiometricOnly] the screen lock is not
   * accepted, which is what sending the master key asks for.
   *
   * Blocks the calling thread, which must not be the main one.
   */
  fun confirm(title: String, description: String, strongBiometricOnly: Boolean = false): Boolean {
    val host = activity() ?: throw PromptUnavailable("The app isn't on screen to ask.")
    val allowed = if (strongBiometricOnly) BIOMETRIC_STRONG else BIOMETRIC_STRONG or DEVICE_CREDENTIAL
    val manager = context.getSystemService(BiometricManager::class.java)
    if (manager?.canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
      throw PromptUnavailable(
        if (strongBiometricOnly) "Set up fingerprint or face unlock to do this."
        else "Set up a screen lock or fingerprint to do this.",
      )
    }
    val done = CountDownLatch(1)
    val confirmed = AtomicBoolean(false)
    val failure = AtomicReference<String?>(null)
    val cancel = CancellationSignal()
    host.runOnUiThread {
      try {
        val builder = BiometricPrompt.Builder(host)
          .setTitle(title)
          .setDescription(description)
          .setAllowedAuthenticators(allowed)
          .setConfirmationRequired(true)
        // A negative button is refused beside the screen lock, which has its own way out.
        if (strongBiometricOnly) {
          builder.setNegativeButton("Cancel", host.mainExecutor) { _, _ -> done.countDown() }
        }
        builder.build().authenticate(
          cancel,
          host.mainExecutor,
          object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              confirmed.set(true)
              done.countDown()
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) {
              when (code) {
                BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED,
                BiometricPrompt.BIOMETRIC_ERROR_CANCELED,
                BiometricPrompt.BIOMETRIC_ERROR_TIMEOUT,
                -> Unit
                else -> failure.set("The prompt ended: $message ($code)")
              }
              done.countDown()
            }
          },
        )
      } catch (e: Exception) {
        failure.set("${e.javaClass.simpleName}: ${e.message ?: "no detail"}")
        done.countDown()
      }
    }
    if (!done.await(WAIT_MINUTES, TimeUnit.MINUTES)) {
      cancel.cancel()
      done.await(5, TimeUnit.SECONDS)
      return false
    }
    failure.get()?.let { throw PromptUnavailable(it) }
    return confirmed.get()
  }

  private companion object {
    const val WAIT_MINUTES = 2L
  }
}
