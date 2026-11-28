package org.coasys.app.devicekey

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Reads one QR code with the camera and hands its text back: CameraX for the preview and the
 * frames, ML Kit's barcode scanner for the reading. The scanner is the **bundled** one
 * (`com.google.mlkit:barcode-scanning`): its model ships inside the app, so reading a code needs
 * no Google Play services and sends nothing anywhere. The text is not interpreted here; the Rust
 * side parses and checks it. A code that does not start with [EXTRA_PREFIX] (a stranger's QR) is
 * passed over with a line saying so.
 *
 * Result: `RESULT_OK` with [EXTRA_TEXT], or `RESULT_CANCELED` (with [EXTRA_REASON] `"denied"`
 * when the camera permission was refused, so the page can offer pasting instead).
 */
class ScanActivity : AppCompatActivity() {
  private lateinit var preview: PreviewView
  private lateinit var hint: TextView
  private lateinit var analysis: ExecutorService
  private val answered = AtomicBoolean(false)
  private val scanner by lazy {
    BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
  }

  private val askCamera =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) startCamera() else finishWith(null, "denied")
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    analysis = Executors.newSingleThreadExecutor()
    setContentView(layout())
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      startCamera()
    } else {
      askCamera.launch(Manifest.permission.CAMERA)
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    scanner.close()
    analysis.shutdown()
  }

  private fun layout(): FrameLayout {
    val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }
    preview = PreviewView(this).apply { layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT) }
    hint = TextView(this).apply {
      text = intent.getStringExtra(EXTRA_TITLE) ?: "Point the camera at the QR code"
      setTextColor(Color.WHITE)
      textSize = 17f
      gravity = Gravity.CENTER
      setPadding(dp(24f), dp(16f), dp(24f), dp(16f))
      setBackgroundColor(0x99000000.toInt())
    }
    val cancel = Button(this).apply {
      text = "Cancel"
      setOnClickListener { finishWith(null, "cancelled") }
    }
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(0, 0, 0, dp(32f))
      addView(hint, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
      addView(cancel, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(16f) })
    }
    return FrameLayout(this).apply {
      setBackgroundColor(Color.BLACK)
      addView(preview)
      addView(bar, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))
    }
  }

  private fun startCamera() {
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
      val provider = try {
        future.get()
      } catch (e: Exception) {
        finishWith(null, "no-camera")
        return@addListener
      }
      val shown = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
      val frames = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
      frames.setAnalyzer(analysis, ::read)
      try {
        provider.unbindAll()
        provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, shown, frames)
      } catch (e: Exception) {
        finishWith(null, "no-camera")
      }
    }, ContextCompat.getMainExecutor(this))
  }

  @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
  private fun read(frame: ImageProxy) {
    val image = frame.image
    if (image == null || answered.get()) {
      frame.close()
      return
    }
    val prefix = intent.getStringExtra(EXTRA_PREFIX) ?: ""
    scanner.process(InputImage.fromMediaImage(image, frame.imageInfo.rotationDegrees))
      .addOnSuccessListener { codes ->
        val texts = codes.mapNotNull { it.rawValue?.trim() }
        val match = texts.firstOrNull { carries(it, prefix) }
        when {
          match != null -> finishWith(match, null)
          texts.isNotEmpty() -> hint.text = "Wrong QR code. Scan the one on your other device."
        }
      }
      .addOnCompleteListener { frame.close() }
  }

  private fun finishWith(text: String?, reason: String?) {
    if (!answered.compareAndSet(false, true)) return
    val data = Intent()
    if (text != null) {
      data.putExtra(EXTRA_TEXT, text)
      setResult(RESULT_OK, data)
    } else {
      data.putExtra(EXTRA_REASON, reason)
      setResult(RESULT_CANCELED, data)
    }
    finish()
  }

  companion object {
    const val EXTRA_PREFIX = "org.coasys.app.scan.prefix"
    const val EXTRA_TITLE = "org.coasys.app.scan.title"
    const val EXTRA_TEXT = "org.coasys.app.scan.text"
    const val EXTRA_REASON = "org.coasys.app.scan.reason"
  }
}

/**
 * Whether a QR code's text is a code of the step: the code itself (`coasys:device:1:…`), or a link
 * carrying it after its `#`, as an offer link does (`https://…/o#coasys:offer:1:…`). The text goes
 * back whole; the Rust crate parses it. Top-level, so a JVM test reaches it without an Activity.
 */
fun carries(text: String, prefix: String): Boolean =
  prefix.isNotEmpty() && (text.startsWith(prefix) || text.substringAfter('#', "").startsWith(prefix))
