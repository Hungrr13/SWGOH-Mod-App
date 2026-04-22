package com.hungrr13.modhelper.overlay

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ResolveInfo
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.content.pm.PackageManager
import android.app.ActivityManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import java.io.File

@ReactModule(name = ModOverlayCaptureModule.NAME)
class ModOverlayCaptureModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private var pendingCapturePromise: Promise? = null
  private var pendingNotificationPromise: Promise? = null
  private var listenerCount = 0

  private val captureTappedReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val action = intent?.action ?: return
      val payload = Arguments.createMap().apply {
        putDouble(
          "timestamp",
          (intent.getLongExtra(ModOverlayCaptureService.EXTRA_CAPTURE_TIMESTAMP, System.currentTimeMillis())).toDouble()
        )
      }

      when (action) {
        ModOverlayCaptureService.ACTION_CAPTURE_TAPPED -> {
          payload.putString("type", "tap")
        }
        ModOverlayCaptureService.ACTION_CAPTURE_SUCCESS -> {
          payload.putString("type", "captureSuccess")
          payload.putString(
            "path",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_PATH)
          )
          payload.putString(
            "ocrText",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_TEXT)
          )
          payload.putString(
            "detectedShape",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_SHAPE)
          )
          payload.putString(
            "detectedSet",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_SET)
          )
          payload.putString(
            "focusedCropPath",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_FOCUSED_PATH)
          )
          payload.putString(
            "statsCropPath",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_STATS_PATH)
          )
          payload.putString(
            "shapeCropPath",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_SHAPE_PATH)
          )
          payload.putString(
            "iconCropPath",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_ICON_PATH)
          )
          payload.putString(
            "setCropPath",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_SET_PATH)
          )
          val topShapeMatches = Arguments.createArray()
          intent.getStringArrayListExtra(ModOverlayCaptureService.EXTRA_CAPTURE_TOP_SHAPE_MATCHES)?.forEach { item ->
            topShapeMatches.pushString(item)
          }
          payload.putArray("topShapeMatches", topShapeMatches)
          val variantShapeJson = intent.getStringExtra(
            ModOverlayCaptureService.EXTRA_CAPTURE_VARIANT_SHAPE_MATCHES_JSON
          )
          if (variantShapeJson != null) {
            payload.putString("variantShapeMatchesJson", variantShapeJson)
          }
          val topSetMatches = Arguments.createArray()
          intent.getStringArrayListExtra(ModOverlayCaptureService.EXTRA_CAPTURE_TOP_SET_MATCHES)?.forEach { item ->
            topSetMatches.pushString(item)
          }
          payload.putArray("topSetMatches", topSetMatches)
          val lines = Arguments.createArray()
          intent.getStringArrayListExtra(ModOverlayCaptureService.EXTRA_CAPTURE_LINES)?.forEach { line ->
            lines.pushString(line)
          }
          payload.putArray("ocrLines", lines)
        }
        ModOverlayCaptureService.ACTION_CAPTURE_ERROR -> {
          payload.putString("type", "captureError")
          payload.putString(
            "message",
            intent.getStringExtra(ModOverlayCaptureService.EXTRA_CAPTURE_ERROR)
          )
        }
      }

      emitEvent(EVENT_CAPTURE_TAPPED, payload)
    }
  }

  private val activityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode == REQUEST_NOTIFICATIONS) {
        pendingNotificationPromise?.resolve(buildStatusMap())
        pendingNotificationPromise = null
        return
      }

      if (requestCode != REQUEST_SCREEN_CAPTURE) {
        return
      }

      if (resultCode == Activity.RESULT_OK && data != null) {
        ModOverlayCaptureService.setProjectionPermission(reactApplicationContext, resultCode, data)
        val primeIntent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
          action = ModOverlayCaptureService.ACTION_PRIME_PROJECTION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          reactApplicationContext.startForegroundService(primeIntent)
        } else {
          reactApplicationContext.startService(primeIntent)
        }
      }

      pendingCapturePromise?.resolve(buildStatusMap())
      pendingCapturePromise = null
    }
  }

  init {
    reactContext.addActivityEventListener(activityEventListener)
    LocalBroadcastManager.getInstance(reactContext).apply {
      registerReceiver(captureTappedReceiver, IntentFilter(ModOverlayCaptureService.ACTION_CAPTURE_TAPPED))
      registerReceiver(captureTappedReceiver, IntentFilter(ModOverlayCaptureService.ACTION_CAPTURE_SUCCESS))
      registerReceiver(captureTappedReceiver, IntentFilter(ModOverlayCaptureService.ACTION_CAPTURE_ERROR))
    }
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    LocalBroadcastManager.getInstance(reactApplicationContext).unregisterReceiver(captureTappedReceiver)
    super.invalidate()
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(buildStatusMap())
  }

  @ReactMethod
  fun requestOverlayPermission(promise: Promise) {
    try {
      if (!Settings.canDrawOverlays(reactApplicationContext)) {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${reactApplicationContext.packageName}")
        ).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
      }
      promise.resolve(buildStatusMap())
    } catch (error: Exception) {
      promise.reject("overlay_permission_error", "Unable to open overlay permission settings.", error)
    }
  }

  @ReactMethod
  fun requestScreenCapture(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("screen_capture_activity_missing", "No active Android activity was available.")
      return
    }

    try {
      val mediaProjectionManager = reactApplicationContext.getSystemService(
        android.content.Context.MEDIA_PROJECTION_SERVICE
      ) as MediaProjectionManager

      pendingCapturePromise = promise
      activity.startActivityForResult(
        mediaProjectionManager.createScreenCaptureIntent(),
        REQUEST_SCREEN_CAPTURE
      )
    } catch (error: Exception) {
      pendingCapturePromise = null
      promise.reject("screen_capture_error", "Unable to request Android screen capture permission.", error)
    }
  }

  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(buildStatusMap())
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("notification_permission_activity_missing", "No active Android activity was available.")
      return
    }

    if (ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      promise.resolve(buildStatusMap())
      return
    }

    pendingNotificationPromise = promise
    activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
  }

  @ReactMethod
  fun startFloatingButton(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action =
          if (ModOverlayCaptureService.hasProjectionPermission(reactApplicationContext)) {
            ModOverlayCaptureService.ACTION_PRIME_PROJECTION
          } else {
            ModOverlayCaptureService.ACTION_START
          }
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }

      promise.resolve(buildStatusMap())
    } catch (error: Exception) {
      promise.reject("overlay_service_error", "Unable to start the overlay capture service.", error)
    }
  }

  @ReactMethod
  fun warmScanner(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action = ModOverlayCaptureService.ACTION_WARM_ONLY
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }

      ModOverlayCaptureService.awaitWarmUp(Runnable {
        promise.resolve(buildStatusMap())
      })
    } catch (error: Exception) {
      promise.reject("overlay_service_warm_error", "Unable to warm the overlay scanner right now.", error)
    }
  }

  @ReactMethod
  fun stopFloatingButton(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action = ModOverlayCaptureService.ACTION_STOP
      }
      reactApplicationContext.startService(intent)
      promise.resolve(buildStatusMap())
    } catch (error: Exception) {
      promise.reject("overlay_service_stop_error", "Unable to stop the overlay capture service.", error)
    }
  }

  @ReactMethod
  fun saveArrowTrainingSample(setName: String, promise: Promise) {
    try {
      val allowed = setOf(
        "Speed", "Health", "Defense", "Offense",
        "Crit Chance", "Crit Dmg", "Tenacity", "Potency",
      )
      if (setName !in allowed) {
        promise.reject("invalid_set", "Unknown set: $setName")
        return
      }
      val cacheDir = File(reactApplicationContext.cacheDir, "overlay-debug")
      val latest = cacheDir.listFiles { f -> f.name.endsWith("-set.png") }
        ?.maxByOrNull { it.lastModified() }
      if (latest == null) {
        promise.reject("no_sample", "No recent -set.png found in overlay-debug.")
        return
      }
      val slug = setName.lowercase().replace(" ", "-")
      val outDir = File(reactApplicationContext.filesDir, "arrow-training/$slug").apply { mkdirs() }
      val dest = File(outDir, latest.name)
      latest.inputStream().use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      }
      val result = Arguments.createMap()
      result.putString("path", dest.absolutePath)
      result.putString("set", setName)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("arrow_training_save_error", "Could not save arrow training sample.", error)
    }
  }

  @ReactMethod
  fun launchSwgoh(promise: Promise) {
    try {
      val packageManager = reactApplicationContext.packageManager
      val packageNames = listOf(
        "com.ea.game.starwarscapital_row",
        "com.ea.games.starwarscapital",
        "com.ea.gp.swgoh",
      )

      var launchIntent = packageNames.firstNotNullOfOrNull { packageName ->
        buildLaunchIntent(packageManager, packageName)
      }

      if (launchIntent == null) {
        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
          addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val swgohMatch = packageManager
          .queryIntentActivities(launcherIntent, PackageManager.MATCH_DEFAULT_ONLY)
          .firstOrNull { resolved ->
            val pkg = resolved.activityInfo?.packageName?.lowercase() ?: return@firstOrNull false
            ("swgoh" in pkg || "starwarscapital" in pkg || "starwarsgalaxy" in pkg) &&
              pkg.startsWith("com.ea")
          }
        launchIntent = swgohMatch?.activityInfo?.let { info ->
          Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            setClassName(info.packageName, info.name)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
          }
        }
      }

      if (launchIntent == null) {
        promise.reject("swgoh_launch_missing", "Star Wars: Galaxy of Heroes is not installed on this device.")
        return
      }

      val activityManager = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val swgohTaskId = activityManager?.appTasks
        ?.firstOrNull { task ->
          task.taskInfo.baseIntent?.component?.packageName == "com.ea.game.starwarscapital_row" ||
            task.taskInfo.topActivity?.packageName == "com.ea.game.starwarscapital_row"
        }
        ?.taskInfo
        ?.taskId

      if (swgohTaskId != null) {
        activityManager?.moveTaskToFront(swgohTaskId, 0)
      } else {
        reactApplicationContext.startActivity(launchIntent)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("swgoh_launch_error", "Unable to open Star Wars: Galaxy of Heroes right now.", error)
    }
  }

  private fun buildLaunchIntent(packageManager: PackageManager, packageName: String): Intent? {
    packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      return intent
    }

    val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
      addCategory(Intent.CATEGORY_LAUNCHER)
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    }

    val resolved: ResolveInfo? = packageManager.queryIntentActivities(launcherIntent, PackageManager.MATCH_DEFAULT_ONLY)
      .firstOrNull()

    return resolved?.activityInfo?.let { activityInfo ->
      Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
        setClassName(activityInfo.packageName, activityInfo.name)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      }
    }
  }

  @ReactMethod
  fun showRecommendationOverlay(title: String, body: String, promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action = ModOverlayCaptureService.ACTION_SHOW_RECOMMENDATION
        putExtra(ModOverlayCaptureService.EXTRA_RECOMMENDATION_TITLE, title)
        putExtra(ModOverlayCaptureService.EXTRA_RECOMMENDATION_BODY, body)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }

      promise.resolve(buildStatusMap())
    } catch (error: Exception) {
      promise.reject("overlay_recommendation_error", "Unable to show the overlay recommendation card.", error)
    }
  }

  @ReactMethod
  fun showDualRecommendationOverlay(
    sliceTitle: String,
    sliceBody: String,
    charTitle: String,
    charBody: String,
    promise: Promise,
  ) {
    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action = ModOverlayCaptureService.ACTION_SHOW_DUAL_RECOMMENDATION
        putExtra(ModOverlayCaptureService.EXTRA_RECOMMENDATION_TITLE, sliceTitle)
        putExtra(ModOverlayCaptureService.EXTRA_RECOMMENDATION_BODY, sliceBody)
        putExtra(ModOverlayCaptureService.EXTRA_CHARACTER_TITLE, charTitle)
        putExtra(ModOverlayCaptureService.EXTRA_CHARACTER_BODY, charBody)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }

      promise.resolve(buildStatusMap())
    } catch (error: Exception) {
      promise.reject("overlay_dual_recommendation_error", "Unable to show the overlay recommendation cards.", error)
    }
  }

  @ReactMethod
  fun hideRecommendationOverlay(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action = ModOverlayCaptureService.ACTION_HIDE_RECOMMENDATION
      }
      reactApplicationContext.startService(intent)
      promise.resolve(buildStatusMap())
    } catch (error: Exception) {
      promise.reject("overlay_recommendation_hide_error", "Unable to hide the overlay recommendation card.", error)
    }
  }

  @ReactMethod
  fun confirmArrowBurstSet(setName: String, promise: Promise) {
    val normalizedSet = setName.trim()
    if (
      normalizedSet != "Crit Chance" &&
      normalizedSet != "Crit Dmg" &&
      normalizedSet != "Offense"
    ) {
      promise.reject("overlay_burst_confirm_invalid", "A supported burst set label is required.")
      return
    }

    try {
      Thread({
        try {
          ModIconClassifier(reactApplicationContext).rememberValidatedArrowBurst(normalizedSet)
          promise.resolve(true)
        } catch (error: Exception) {
          promise.reject("overlay_burst_confirm_error", "Unable to save the confirmed burst set right now.", error)
        }
      }, "ConfirmArrowBurstSet").start()
    } catch (error: Exception) {
      promise.reject("overlay_burst_confirm_error", "Unable to save the confirmed burst set right now.", error)
    }
  }

  @ReactMethod
  fun confirmOuterShape(shapeName: String, promise: Promise) {
    val normalizedShape = shapeName.trim()
    if (
      normalizedShape != "Arrow" &&
      normalizedShape != "Triangle" &&
      normalizedShape != "Circle" &&
      normalizedShape != "Cross" &&
      normalizedShape != "Diamond" &&
      normalizedShape != "Square"
    ) {
      promise.reject("overlay_shape_confirm_invalid", "A supported outer shape label is required.")
      return
    }

    try {
      val intent = Intent(reactApplicationContext, ModOverlayCaptureService::class.java).apply {
        action = ModOverlayCaptureService.ACTION_CONFIRM_OUTER_SHAPE
        putExtra(ModOverlayCaptureService.EXTRA_CONFIRMED_SHAPE, normalizedShape)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("overlay_shape_confirm_error", "Unable to save the confirmed shape right now.", error)
    }
  }

  @ReactMethod
  fun analyzeCapturedImage(imagePath: String, promise: Promise) {
    if (imagePath.isBlank()) {
      promise.reject("capture_path_missing", "A screenshot path is required for OCR analysis.")
      return
    }

    val imageFile = File(imagePath)
    if (!imageFile.exists()) {
      promise.reject("capture_path_invalid", "The screenshot file could not be found.")
      return
    }

    try {
      val image = InputImage.fromFilePath(reactApplicationContext, Uri.fromFile(imageFile))
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

      recognizer.process(image)
        .addOnSuccessListener { visionText ->
          val result = Arguments.createMap().apply {
            putString("text", visionText.text)
            putArray("lines", extractLines(visionText.textBlocks))
            putInt("blockCount", visionText.textBlocks.size)
            putString("imagePath", imagePath)
          }
          promise.resolve(result)
          recognizer.close()
        }
        .addOnFailureListener { error ->
          promise.reject("capture_ocr_error", "ML Kit text recognition failed.", error)
          recognizer.close()
        }
    } catch (error: Exception) {
      promise.reject("capture_ocr_setup_error", "Could not prepare screenshot OCR analysis.", error)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = (listenerCount - count).coerceAtLeast(0)
  }

  private fun emitEvent(eventName: String, payload: com.facebook.react.bridge.WritableMap?) {
    android.util.Log.d("ModOverlayCapture", "emitEvent: name=$eventName listenerCount=$listenerCount hasCatalyst=${reactApplicationContext.hasActiveCatalystInstance()}")
    if (!reactApplicationContext.hasActiveCatalystInstance()) {
      return
    }
    try {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, payload)
    } catch (error: Exception) {
      android.util.Log.w("ModOverlayCapture", "emitEvent failed", error)
    }
  }

  private fun extractLines(blocks: List<com.google.mlkit.vision.text.Text.TextBlock>): WritableArray {
    val lines = Arguments.createArray()
    blocks.forEach { block ->
      block.lines.forEach { line ->
        val lineMap = Arguments.createMap().apply {
          putString("text", line.text)
        }
        lines.pushMap(lineMap)
      }
    }
    return lines
  }

  private fun buildStatusMap() = Arguments.createMap().apply {
    putBoolean("platformSupported", true)
    putBoolean("nativeModuleReady", true)
    putBoolean(
      "notificationPermissionGranted",
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    )
    putBoolean("overlayPermissionGranted", Settings.canDrawOverlays(reactApplicationContext))
    putBoolean("screenCaptureReady", ModOverlayCaptureService.hasProjectionPermission(reactApplicationContext))
    putBoolean("floatingButtonRunning", ModOverlayCaptureService.isBubbleVisible)
  }

  private fun isOverlayServiceRunning(): Boolean {
    val activityManager = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return ModOverlayCaptureService.isRunning

    @Suppress("DEPRECATION")
    val serviceRunning = activityManager
      .getRunningServices(Int.MAX_VALUE)
      .any { service -> service.service.className == ModOverlayCaptureService::class.java.name }

    return serviceRunning || ModOverlayCaptureService.isRunning
  }

  companion object {
    const val NAME = "ModOverlayCapture"
    const val EVENT_CAPTURE_TAPPED = "overlayCaptureTapped"
    private const val REQUEST_SCREEN_CAPTURE = 4817
    private const val REQUEST_NOTIFICATIONS = 4818
  }
}
