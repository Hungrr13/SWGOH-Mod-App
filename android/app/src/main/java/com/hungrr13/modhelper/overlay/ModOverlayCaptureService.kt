package com.hungrr13.modhelper.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.pm.ServiceInfo
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.hungrr13.modhelper.R
import java.io.File
import java.io.FileOutputStream
import java.util.ArrayList
import java.util.LinkedHashSet

class ModOverlayCaptureService : Service() {
  private data class DebugCropPaths(
    val focusedPath: String?,
    val statsPath: String?,
    val shapePath: String?,
    val iconPath: String?,
    val setPath: String?,
  )

  private val logTag = "ModOverlayCapture"
  private val iconClassifier by lazy { ModIconClassifier(this) }
  private var textRecognizerInitialized = false
  private val textRecognizer by lazy {
    textRecognizerInitialized = true
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }
  private var windowManager: WindowManager? = null
  private var floatingBubble: TextView? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private var scanningAnimationRunnable: Runnable? = null
  private var scanningAnimationStep = 0
  private var scanningAnimationThread: HandlerThread? = null
  private var scanningAnimationHandler: Handler? = null
  private var overlayParams: WindowManager.LayoutParams? = null
  private var recommendationCard: LinearLayout? = null
  private var recommendationTitleView: TextView? = null
  private var recommendationBodyView: TextView? = null
  private var recommendationActionLabelView: TextView? = null
  private var recommendationActionContainer: LinearLayout? = null
  private var recommendationParams: WindowManager.LayoutParams? = null
  private var characterCard: LinearLayout? = null
  private var characterTitleView: TextView? = null
  private var characterBodyView: TextView? = null
  private var characterParams: WindowManager.LayoutParams? = null
  private var arrowTrainingCard: LinearLayout? = null
  private var arrowTrainingStatusView: TextView? = null
  private var arrowTrainingParams: WindowManager.LayoutParams? = null
  private var captureThread: HandlerThread? = null
  private var captureHandler: Handler? = null
  private var mediaProjection: MediaProjection? = null
  private var mediaProjectionCallback: MediaProjection.Callback? = null
  private var captureImageReader: ImageReader? = null
  private var captureVirtualDisplay: VirtualDisplay? = null
  private var captureWidth = 0
  private var captureHeight = 0
  private var captureDensityDpi = 0
  private var isCapturing = false
  @Volatile private var warmUpStarted = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureProjectionPermissionLoaded(this)
    isRunning = true
    ensureNotificationChannel()
    ensureCaptureThread()
    warmUpScanner()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureCaptureThread()
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_CONFIRM_ARROW_BURST -> {
        val confirmedSet = intent.getStringExtra(EXTRA_CONFIRMED_SET).orEmpty()
        if (confirmedSet.isNotBlank()) {
          iconClassifier.rememberValidatedArrowBurst(confirmedSet)
        }
        restoreIdleOverlayState()
        attachFloatingBubble()
        return START_STICKY
      }
      ACTION_CONFIRM_OUTER_SHAPE -> {
        val confirmedShape = intent.getStringExtra(EXTRA_CONFIRMED_SHAPE).orEmpty()
        if (confirmedShape.isNotBlank()) {
          iconClassifier.rememberValidatedShape(confirmedShape)
        }
        restoreIdleOverlayState()
        attachFloatingBubble()
        return START_STICKY
      }
      ACTION_SHOW_RECOMMENDATION -> {
        restoreIdleOverlayState()
        attachFloatingBubble()
        showRecommendationOverlay(
          intent.getStringExtra(EXTRA_RECOMMENDATION_TITLE).orEmpty(),
          intent.getStringExtra(EXTRA_RECOMMENDATION_BODY).orEmpty(),
        )
        return START_STICKY
      }
      ACTION_SHOW_DUAL_RECOMMENDATION -> {
        restoreIdleOverlayState()
        attachFloatingBubble()
        showRecommendationOverlay(
          intent.getStringExtra(EXTRA_RECOMMENDATION_TITLE).orEmpty(),
          intent.getStringExtra(EXTRA_RECOMMENDATION_BODY).orEmpty(),
        )
        showCharacterOverlay(
          intent.getStringExtra(EXTRA_CHARACTER_TITLE).orEmpty(),
          intent.getStringExtra(EXTRA_CHARACTER_BODY).orEmpty(),
        )
        return START_STICKY
      }
      ACTION_HIDE_RECOMMENDATION -> {
        hideRecommendationOverlay()
        hideCharacterOverlay()
        hideArrowTrainingOverlay()
        restoreIdleOverlayState()
        attachFloatingBubble()
        return START_STICKY
      }
      ACTION_PRIME_PROJECTION -> {
        restoreIdleOverlayState()
        attachFloatingBubble()
        primeProjectionIfPossible()
        return START_STICKY
      }
      ACTION_WARM_ONLY -> {
        restoreIdleOverlayState(showBubble = false)
        primeProjectionIfPossible()
        return START_STICKY
      }
      else -> {
        restoreIdleOverlayState()
        attachFloatingBubble()
        primeProjectionIfPossible()
        return START_STICKY
      }
    }
  }

  override fun onDestroy() {
    removeFloatingBubble()
    hideRecommendationOverlay()
    hideArrowTrainingOverlay()
    clearMediaProjection()
    try {
      if (textRecognizerInitialized) {
        textRecognizer.close()
      }
    } catch (_: Exception) {
    }
    captureThread?.quitSafely()
    captureThread = null
    captureHandler = null
    isRunning = false
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  private fun ensureCaptureThread() {
    val existingThread = captureThread
    val existingHandler = captureHandler
    if (existingThread != null && existingThread.isAlive && existingHandler != null) {
      return
    }

    captureThread?.quitSafely()
    captureThread = HandlerThread("ModOverlayCapture").apply { start() }
    captureHandler = Handler(captureThread!!.looper)
  }

  private fun warmUpScanner() {
    if (warmUpStarted) {
      return
    }
    warmUpStarted = true
    Thread({
      val ocrReady = java.util.concurrent.atomic.AtomicBoolean(false)
      val classifierReady = java.util.concurrent.atomic.AtomicBoolean(false)
      val completeIfReady = {
        if (ocrReady.get() && classifierReady.get()) {
          Log.d(logTag, "warmUpScanner: all warm-up steps complete")
          markWarmedUp()
        }
      }

      try {
        Log.d(logTag, "warmUpScanner: priming OCR recognizer")
        val warmBitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val warmInput = InputImage.fromBitmap(warmBitmap, 0)
        textRecognizer.process(warmInput).addOnCompleteListener {
          warmBitmap.recycle()
          Log.d(logTag, "warmUpScanner: OCR recognizer primed")
          ocrReady.set(true)
          completeIfReady()
        }
      } catch (error: Exception) {
        Log.w(logTag, "warmUpScanner: OCR warm-up failed", error)
        ocrReady.set(true)
        completeIfReady()
      }

      try {
        Log.d(logTag, "warmUpScanner: preloading classifier assets (blocking)")
        iconClassifier.warmUpBlocking()
        Log.d(logTag, "warmUpScanner: classifier assets ready")
      } catch (error: Exception) {
        Log.w(logTag, "warmUpScanner: classifier warm-up failed", error)
      }
      classifierReady.set(true)
      completeIfReady()
    }, "ModOverlayWarmup").start()
  }

  private fun attachFloatingBubble() {
    if (!Settings.canDrawOverlays(this)) {
      isBubbleVisible = false
      return
    }

    if (floatingBubble != null) {
      isBubbleVisible = true
      return
    }

    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      layoutType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = 36
      y = 240
    }

    val bubble = TextView(this).apply {
      text = "Scan"
      textSize = 14f
      setTextColor(0xFF0A0E17.toInt())
      setPadding(32, 20, 32, 20)
      setBackgroundColor(0xFFF5A623.toInt())
      elevation = 12f
      setOnClickListener {
        performScreenshotCapture()
      }
      setOnTouchListener(object : android.view.View.OnTouchListener {
        private val touchSlop = android.view.ViewConfiguration.get(this@ModOverlayCaptureService).scaledTouchSlop
        private var startX = 0
        private var startY = 0
        private var touchStartX = 0f
        private var touchStartY = 0f
        private var isDragging = false

        override fun onTouch(v: android.view.View?, event: MotionEvent): Boolean {
          val activeParams = overlayParams ?: return false
          when (event.action) {
            MotionEvent.ACTION_DOWN -> {
              startX = activeParams.x
              startY = activeParams.y
              touchStartX = event.rawX
              touchStartY = event.rawY
              isDragging = false
              return false
            }
            MotionEvent.ACTION_MOVE -> {
              val dx = event.rawX - touchStartX
              val dy = event.rawY - touchStartY
              if (!isDragging && kotlin.math.hypot(dx, dy) < touchSlop) {
                // Within slop — treat as still-a-tap, don't move the view.
                return false
              }
              isDragging = true
              activeParams.x = startX - dx.toInt()
              activeParams.y = startY + dy.toInt()
              windowManager?.updateViewLayout(floatingBubble, activeParams)
              return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
              // If we were dragging, consume the up so it doesn't fire a click.
              return isDragging
            }
          }
          return false
        }
      })
    }

    overlayParams = params
    floatingBubble = bubble
    windowManager?.addView(bubble, params)
    isBubbleVisible = true
  }

  private fun removeFloatingBubble() {
    floatingBubble?.let { bubble ->
      windowManager?.removeView(bubble)
    }
    floatingBubble = null
    overlayParams = null
    windowManager = null
    isBubbleVisible = false
  }

  private fun showRecommendationOverlay(
    title: String,
    body: String,
    includeShapeActions: Boolean = false,
  ) {
    if (!Settings.canDrawOverlays(this)) {
      return
    }

    if (windowManager == null) {
      windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    val wm = windowManager ?: return
    val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      WindowManager.LayoutParams.TYPE_PHONE
    }

    if (recommendationCard == null) {
      val card = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(28, 22, 28, 22)
        setBackgroundColor(0xEE111827.toInt())
        elevation = 16f
        setOnClickListener {
          hideRecommendationOverlay()
          restoreIdleOverlayState()
          attachFloatingBubble()
        }
      }

      val titleView = TextView(this).apply {
        textSize = 15f
        setTextColor(0xFFF8FAFC.toInt())
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      }

      val bodyView = TextView(this).apply {
        textSize = 12f
        setTextColor(0xFFE2E8F0.toInt())
        setPadding(0, 10, 0, 0)
      }

      val actionLabelView = TextView(this).apply {
        text = "Teach Outer Shape"
        textSize = 12f
        setTextColor(0xFFF8FAFC.toInt())
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, 16, 0, 8)
        visibility = android.view.View.GONE
      }

      val actionContainer = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        visibility = android.view.View.GONE
      }

      val shapeRows = listOf(
        listOf("Arrow", "Triangle", "Circle"),
        listOf("Cross", "Diamond", "Square"),
      )
      shapeRows.forEachIndexed { rowIndex, rowShapes ->
        val rowLayout = LinearLayout(this).apply {
          orientation = LinearLayout.HORIZONTAL
          if (rowIndex > 0) {
            setPadding(0, 8, 0, 0)
          }
        }
        rowShapes.forEachIndexed { columnIndex, shapeName ->
          rowLayout.addView(
            buildRecommendationActionButton(shapeName).apply {
              layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                if (columnIndex > 0) {
                  marginStart = 8
                }
              }
            }
          )
        }
        actionContainer.addView(rowLayout)
      }

      card.addView(titleView)
      card.addView(bodyView)
      card.addView(actionLabelView)
      card.addView(actionContainer)

      val screenWidth = resources.displayMetrics.widthPixels
      recommendationCard = card
      recommendationTitleView = titleView
      recommendationBodyView = bodyView
      recommendationActionLabelView = actionLabelView
      recommendationActionContainer = actionContainer
        recommendationParams = WindowManager.LayoutParams(
          (screenWidth * 0.32f).toInt(),
          WindowManager.LayoutParams.WRAP_CONTENT,
          layoutType,
          WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
          PixelFormat.TRANSLUCENT,
        ).apply {
        gravity = Gravity.TOP or Gravity.END
        x = 10
        y = 410
      }
      card.setOnTouchListener { _, event ->
        if (event.action == android.view.MotionEvent.ACTION_OUTSIDE) {
          hideRecommendationOverlay()
          hideCharacterOverlay()
          true
        } else {
          false
        }
      }
    }

    recommendationTitleView?.text = title.ifBlank { getString(R.string.mod_overlay_recommendation_title_default) }
    recommendationBodyView?.text = body.ifBlank { getString(R.string.mod_overlay_recommendation_body_default) }
    recommendationActionLabelView?.visibility =
      if (includeShapeActions) android.view.View.VISIBLE else android.view.View.GONE
    recommendationActionContainer?.visibility =
      if (includeShapeActions) android.view.View.VISIBLE else android.view.View.GONE

    recommendationCard?.let { card ->
      if (card.parent == null) {
        wm.addView(card, recommendationParams)
      } else {
        wm.updateViewLayout(card, recommendationParams)
      }
    }
  }

  private fun hideRecommendationOverlay() {
    recommendationCard?.let { card ->
      try {
        windowManager?.removeView(card)
      } catch (_: Exception) {
      }
    }
  }

  private fun showCharacterOverlay(title: String, body: String) {
    if (!Settings.canDrawOverlays(this)) {
      return
    }

    if (windowManager == null) {
      windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    val wm = windowManager ?: return
    val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    if (characterCard == null) {
      val card = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(28, 22, 28, 22)
        setBackgroundColor(0xEE111827.toInt())
        elevation = 16f
        setOnClickListener {
          hideCharacterOverlay()
        }
      }

      val titleView = TextView(this).apply {
        textSize = 15f
        setTextColor(0xFFF8FAFC.toInt())
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      }

      val bodyView = TextView(this).apply {
        textSize = 12f
        setTextColor(0xFFE2E8F0.toInt())
        setPadding(0, 10, 0, 0)
      }

      card.addView(titleView)
      card.addView(bodyView)

      val screenWidth = resources.displayMetrics.widthPixels
      characterCard = card
      characterTitleView = titleView
      characterBodyView = bodyView
      characterParams = WindowManager.LayoutParams(
        (screenWidth * 0.32f).toInt(),
        WindowManager.LayoutParams.WRAP_CONTENT,
        layoutType,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
          or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
          or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = 10
        y = 410
      }
      card.setOnTouchListener { _, event ->
        if (event.action == android.view.MotionEvent.ACTION_OUTSIDE) {
          hideRecommendationOverlay()
          hideCharacterOverlay()
          true
        } else {
          false
        }
      }
    }

    characterTitleView?.text = title.ifBlank { "Top Users" }
    characterBodyView?.text = body.ifBlank { "No users found." }

    characterCard?.let { card ->
      if (card.parent == null) {
        wm.addView(card, characterParams)
      } else {
        wm.updateViewLayout(card, characterParams)
      }
    }
  }

  private fun hideCharacterOverlay() {
    characterCard?.let { card ->
      try {
        windowManager?.removeView(card)
      } catch (_: Exception) {
      }
    }
  }

  private fun buildRecommendationActionButton(shapeName: String): TextView {
    return TextView(this).apply {
      text = shapeName
      gravity = Gravity.CENTER
      textSize = 12f
      setTextColor(0xFFF8FAFC.toInt())
      setPadding(0, 18, 0, 18)
      setBackgroundColor(0x223B82F6.toInt())
      isClickable = true
      isFocusable = false
      setOnClickListener {
        iconClassifier.rememberValidatedShape(shapeName)
        hideRecommendationOverlay()
        restoreIdleOverlayState()
        attachFloatingBubble()
      }
    }
  }

  private fun showArrowTrainingOverlay() {
    if (!Settings.canDrawOverlays(this)) {
      return
    }

    if (windowManager == null) {
      windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    val wm = windowManager ?: return
    val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    if (arrowTrainingCard == null) {
      val card = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(28, 22, 28, 22)
        setBackgroundColor(0xEE111827.toInt())
        elevation = 16f
      }

      val trainingProfileLabel = (SET_TRAINING_PROFILE ?: "arrow").replaceFirstChar { it.uppercase() }
      val titleView = TextView(this).apply {
        text = "Label $trainingProfileLabel Set"
        textSize = 13f
        setTextColor(0xFFF8FAFC.toInt())
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      }

      val statusView = TextView(this).apply {
        textSize = 11f
        setTextColor(0xFF9CA3AF.toInt())
        setPadding(0, 4, 0, 10)
        text = "Tap the correct set to save the latest scan."
      }

      val actionContainer = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
      }

      val setRows = listOf(
        listOf("Speed", "Health", "Defense", "Offense"),
        listOf("Crit Chance", "Crit Dmg", "Tenacity", "Potency"),
      )
      setRows.forEachIndexed { rowIndex, rowSets ->
        val rowLayout = LinearLayout(this).apply {
          orientation = LinearLayout.HORIZONTAL
          if (rowIndex > 0) {
            setPadding(0, 8, 0, 0)
          }
        }
        rowSets.forEachIndexed { columnIndex, setName ->
          rowLayout.addView(
            buildArrowTrainingButton(setName).apply {
              layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                if (columnIndex > 0) {
                  marginStart = 8
                }
              }
            }
          )
        }
        actionContainer.addView(rowLayout)
      }

      val closeRow = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, 10, 0, 0)
      }
      val closeButton = TextView(this).apply {
        text = "Close"
        gravity = Gravity.CENTER
        textSize = 11f
        setTextColor(0xFFF8FAFC.toInt())
        setPadding(0, 14, 0, 14)
        setBackgroundColor(0x336B7280.toInt())
        isClickable = true
        setOnClickListener {
          hideArrowTrainingOverlay()
          restoreIdleOverlayState()
          attachFloatingBubble()
        }
        layoutParams = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        )
      }
      closeRow.addView(closeButton)

      card.addView(titleView)
      card.addView(statusView)
      card.addView(actionContainer)
      card.addView(closeRow)

      val screenWidth = resources.displayMetrics.widthPixels
      arrowTrainingCard = card
      arrowTrainingStatusView = statusView
      arrowTrainingParams = WindowManager.LayoutParams(
        (screenWidth * 0.60f).toInt(),
        WindowManager.LayoutParams.WRAP_CONTENT,
        layoutType,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
          or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        x = 0
        y = 120
      }
    }

    arrowTrainingStatusView?.text = "Tap the correct set to save the latest scan."

    arrowTrainingCard?.let { card ->
      if (card.parent == null) {
        wm.addView(card, arrowTrainingParams)
      } else {
        wm.updateViewLayout(card, arrowTrainingParams)
      }
    }
  }

  private fun hideArrowTrainingOverlay() {
    arrowTrainingCard?.let { card ->
      try {
        windowManager?.removeView(card)
      } catch (_: Exception) {
      }
    }
  }

  private fun buildArrowTrainingButton(setName: String): TextView {
    return TextView(this).apply {
      text = setName
      gravity = Gravity.CENTER
      textSize = 11f
      setTextColor(0xFFF8FAFC.toInt())
      setPadding(0, 18, 0, 18)
      setBackgroundColor(0x223B82F6.toInt())
      isClickable = true
      isFocusable = false
      setOnClickListener {
        val result = saveLatestArrowSampleForSet(setName)
        arrowTrainingStatusView?.text = result
      }
    }
  }

  private fun saveLatestArrowSampleForSet(setName: String): String {
    return try {
      val cacheDir = File(cacheDir, "overlay-debug")
      val latest = cacheDir.listFiles { f -> f.name.endsWith("-set.png") }
        ?.maxByOrNull { it.lastModified() }
      if (latest == null) {
        "No recent -set.png found."
      } else {
        val slug = setName.lowercase().replace(" ", "-")
        val profileDir = (SET_TRAINING_PROFILE ?: "arrow") + "-training"
        val outDir = File(filesDir, "$profileDir/$slug").apply { mkdirs() }
        val dest = File(outDir, latest.name)
        latest.inputStream().use { input ->
          dest.outputStream().use { output -> input.copyTo(output) }
        }
        Log.d(logTag, "saveLatestArrowSampleForSet: saved ${dest.absolutePath}")
        "Saved to $slug: ${latest.name}"
      }
    } catch (error: Exception) {
      Log.e(logTag, "saveLatestArrowSampleForSet failed", error)
      "Save failed: ${error.message ?: "unknown"}"
    }
  }

  private fun restoreIdleOverlayState(showBubble: Boolean = true) {
    val foregroundServiceType =
      if (mediaProjection != null || hasProjectionPermission(this)) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      } else {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      }
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      buildNotification(),
      foregroundServiceType,
    )
    if (showBubble) {
      attachFloatingBubble()
    }
    // Warm-only paths intentionally do not remove an existing bubble: if a
    // previous PRIME_PROJECTION already attached it, a later AppState-change
    // triggered warmScanner would otherwise race with the Start flow and tear
    // the bubble down right before we swap to SWGOH.
    isRunning = true
  }

  private fun startScanningAnimation() {
    stopScanningAnimation()
    scanningAnimationStep = 0
    val thread = HandlerThread("scan-anim").apply { start() }
    val handler = Handler(thread.looper)
    scanningAnimationThread = thread
    scanningAnimationHandler = handler
    val runnable = object : Runnable {
      override fun run() {
        val dotCount = (scanningAnimationStep % 3) + 1
        val dots = ".".repeat(dotCount) + "\u00A0".repeat(3 - dotCount)
        val step = scanningAnimationStep
        scanningAnimationStep += 1
        Log.d(logTag, "scanAnim: tick step=$step dots=$dotCount")
        mainHandler.post {
          val bubble = floatingBubble ?: return@post
          bubble.text = "Scanning$dots"
        }
        handler.postDelayed(this, 400)
      }
    }
    scanningAnimationRunnable = runnable
    handler.post(runnable)
  }

  private fun stopScanningAnimation() {
    scanningAnimationRunnable?.let { runnable ->
      scanningAnimationHandler?.removeCallbacks(runnable)
    }
    scanningAnimationRunnable = null
    scanningAnimationHandler = null
    scanningAnimationThread?.quitSafely()
    scanningAnimationThread = null
    mainHandler.post {
      floatingBubble?.text = "Scan"
    }
  }

  private fun performScreenshotCapture() {
    Log.d(logTag, "performScreenshotCapture: tap received")
    LocalBroadcastManager.getInstance(this).sendBroadcast(Intent(ACTION_CAPTURE_TAPPED))
    hideRecommendationOverlay()
    hideArrowTrainingOverlay()
    startScanningAnimation()
    ensureProjectionPermissionLoaded(this)
    ensureCaptureThread()

    if (isCapturing) {
      sendCaptureError("Capture already in progress.")
      return
    }

    val resultCode = projectionResultCode
    val resultData = projectionDataIntent
    if (resultCode == null || resultData == null) {
      sendCaptureError("Screen capture permission is required before taking a screenshot.")
      return
    }

    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
      )
      Log.d(logTag, "performScreenshotCapture: promoted service to mediaProjection")
    } catch (error: Exception) {
      Log.e(logTag, "performScreenshotCapture: failed to promote service", error)
      sendCaptureError("Could not prepare Android screen capture.")
      return
    }

    val displayMetrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    windowManager?.defaultDisplay?.getRealMetrics(displayMetrics)
    if (displayMetrics.widthPixels <= 0 || displayMetrics.heightPixels <= 0) {
      sendCaptureError("Could not determine screen size for capture.")
      return
    }

    val projection = try {
      getOrCreateMediaProjection(resultCode, resultData)
    } catch (error: SecurityException) {
      Log.e(logTag, "performScreenshotCapture: stale projection token", error)
      clearProjectionPermission(this)
      clearMediaProjection()
      sendCaptureError("Screen capture permission expired. Open the scanner screen and allow screen capture again.")
      return
    }
    if (projection == null) {
      Log.e(logTag, "performScreenshotCapture: projection was null")
      sendCaptureError("Could not start Android screen capture.")
      return
    }

    val handler = captureHandler
    if (handler == null) {
      sendCaptureError("Capture thread is not available.")
      return
    }

    val captureSessionReady = try {
      ensureCaptureSession(projection, displayMetrics, handler)
    } catch (error: SecurityException) {
      Log.e(logTag, "performScreenshotCapture: capture session rejected", error)
      clearProjectionPermission(this)
      clearMediaProjection()
      sendCaptureError("Screen capture permission expired. Open the scanner screen and allow screen capture again.")
      return
    }
    if (!captureSessionReady) {
      sendCaptureError("Could not start Android screen capture.")
      return
    }

    captureImageReader?.acquireLatestImage()?.close()
    val imageReader = captureImageReader
    if (imageReader == null) {
      sendCaptureError("Could not start Android screen capture.")
      return
    }

    isCapturing = true

    handler.postDelayed({
      try {
        Log.d(logTag, "performScreenshotCapture: acquiring latest image")
        val image = imageReader.acquireLatestImage()
        if (image == null) {
          Log.e(logTag, "performScreenshotCapture: image was null")
          sendCaptureError("No screenshot image was available yet.")
          return@postDelayed
        }

        val plane = image.planes.firstOrNull()
        if (plane == null) {
          image.close()
          sendCaptureError("Captured image had no readable plane.")
          return@postDelayed
        }

        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width

        val paddedBitmap = Bitmap.createBitmap(
          image.width + rowPadding / pixelStride,
          image.height,
          Bitmap.Config.ARGB_8888,
        )
        paddedBitmap.copyPixelsFromBuffer(buffer)

        val croppedBitmap = Bitmap.createBitmap(paddedBitmap, 0, 0, image.width, image.height)
        val focusedBitmap = cropForModCard(croppedBitmap)
        val statsBitmap = cropForStatsPanel(focusedBitmap)
        val scaledStatsBitmap = scaleForOcr(statsBitmap)
        val shapeDebugBitmap = cropForShapeDebug(focusedBitmap)
        val iconDebugBitmap = cropForIconRegion(focusedBitmap)
        val setDebugBitmap = cropForSetSymbol(iconDebugBitmap)
        val debugCropPaths = DebugCropPaths(
          focusedPath = saveDebugBitmap("focused", focusedBitmap),
          statsPath = saveDebugBitmap("stats", statsBitmap),
          shapePath = saveDebugBitmap("shape", shapeDebugBitmap),
          iconPath = saveDebugBitmap("icon", iconDebugBitmap),
          setPath = saveDebugBitmap("set", setDebugBitmap),
        )
        shapeDebugBitmap.recycle()
        setDebugBitmap.recycle()
        iconDebugBitmap.recycle()

        fun classifyWithOcrHint(ocrText: String, ocrLines: List<String>): ModIconClassifier.Detection? {
          return try {
            val profileHint = FORCED_DEBUG_SET_PROFILE
              ?: preferredSetProfileFromOcr(ocrText, ocrLines)
            iconClassifier.classify(
              focusedBitmap,
              profileHint,
              skipSetDetection = ARROW_SET_TRAINING_MODE,
            )
          } catch (_: Exception) {
            null
          }
        }

        recognizeBitmap(scaledStatsBitmap,
          onSuccess = { statsText, statsLines ->
            if (isRecognitionStrongEnough(statsText, statsLines, expectStatsPanel = true)) {
              val iconDetection = classifyWithOcrHint(statsText, statsLines)
              sendCaptureSuccess(
                statsText,
                statsLines,
                iconDetection,
                debugCropPaths,
              )
              scaledStatsBitmap.recycle()
              statsBitmap.recycle()
              focusedBitmap.recycle()
              croppedBitmap.recycle()
              paddedBitmap.recycle()
              image.close()
              isCapturing = false
              mainHandler.post { restoreIdleOverlayState() }
            } else {
              val scaledFocusedBitmap = scaleForOcr(focusedBitmap)
              recognizeBitmap(scaledFocusedBitmap,
                onSuccess = { focusedText, focusedLines ->
                  val mergedText = mergeOcrText(statsText, focusedText)
                  val mergedLines = mergeOcrLines(statsLines, focusedLines)
                  if (isRecognitionStrongEnough(mergedText, mergedLines, expectStatsPanel = true)) {
                    val iconDetection = classifyWithOcrHint(mergedText, mergedLines)
                    sendCaptureSuccess(
                      mergedText,
                      mergedLines,
                      iconDetection,
                      debugCropPaths,
                    )
                    scaledFocusedBitmap.recycle()
                    scaledStatsBitmap.recycle()
                    statsBitmap.recycle()
                    focusedBitmap.recycle()
                    croppedBitmap.recycle()
                    paddedBitmap.recycle()
                    image.close()
                    isCapturing = false
                    mainHandler.post { restoreIdleOverlayState() }
                  } else {
                    recognizeBitmap(croppedBitmap,
                      onSuccess = { fullText, fullLines ->
                        val chosenText = mergeOcrText(mergedText, fullText)
                        val chosenLines = mergeOcrLines(mergedLines, fullLines)
                        val iconDetection = classifyWithOcrHint(chosenText, chosenLines)
                        sendCaptureSuccess(
                          chosenText,
                          chosenLines,
                          iconDetection,
                          debugCropPaths,
                        )
                        scaledFocusedBitmap.recycle()
                        scaledStatsBitmap.recycle()
                        statsBitmap.recycle()
                        focusedBitmap.recycle()
                        croppedBitmap.recycle()
                        paddedBitmap.recycle()
                        image.close()
                        isCapturing = false
                        mainHandler.post { restoreIdleOverlayState() }
                      },
                      onFailure = { error ->
                        sendCaptureError(error.message ?: "Unable to read text from the captured mod.")
                        scaledFocusedBitmap.recycle()
                        scaledStatsBitmap.recycle()
                        statsBitmap.recycle()
                        focusedBitmap.recycle()
                        croppedBitmap.recycle()
                        paddedBitmap.recycle()
                        image.close()
                        isCapturing = false
                      }
                    )
                  }
                },
                onFailure = {
                  recognizeBitmap(croppedBitmap,
                    onSuccess = { fullText, fullLines ->
                      val chosenText = mergeOcrText(statsText, fullText)
                      val chosenLines = mergeOcrLines(statsLines, fullLines)
                      val iconDetection = classifyWithOcrHint(chosenText, chosenLines)
                      sendCaptureSuccess(
                        chosenText,
                        chosenLines,
                        iconDetection,
                        debugCropPaths,
                      )
                      scaledStatsBitmap.recycle()
                      statsBitmap.recycle()
                      focusedBitmap.recycle()
                      croppedBitmap.recycle()
                      paddedBitmap.recycle()
                      image.close()
                      isCapturing = false
                      mainHandler.post { restoreIdleOverlayState() }
                    },
                    onFailure = { error ->
                      sendCaptureError(error.message ?: "Unable to read text from the captured mod.")
                      scaledStatsBitmap.recycle()
                      statsBitmap.recycle()
                      focusedBitmap.recycle()
                      croppedBitmap.recycle()
                      paddedBitmap.recycle()
                      image.close()
                      isCapturing = false
                    }
                  )
                }
              )
            }
          },
          onFailure = {
            val scaledFocusedBitmap = scaleForOcr(focusedBitmap)
            recognizeBitmap(scaledFocusedBitmap,
              onSuccess = { focusedText, focusedLines ->
                if (isRecognitionStrongEnough(focusedText, focusedLines, expectStatsPanel = true)) {
                  val iconDetection = classifyWithOcrHint(focusedText, focusedLines)
                  sendCaptureSuccess(
                    focusedText,
                    focusedLines,
                    iconDetection,
                    debugCropPaths,
                  )
                  scaledFocusedBitmap.recycle()
                  scaledStatsBitmap.recycle()
                  statsBitmap.recycle()
                  focusedBitmap.recycle()
                  croppedBitmap.recycle()
                  paddedBitmap.recycle()
                  image.close()
                  isCapturing = false
                  mainHandler.post { restoreIdleOverlayState() }
                } else {
                  recognizeBitmap(croppedBitmap,
                    onSuccess = { fullText, fullLines ->
                      val chosenText = mergeOcrText(focusedText, fullText)
                      val chosenLines = mergeOcrLines(focusedLines, fullLines)
                      val iconDetection = classifyWithOcrHint(chosenText, chosenLines)
                      sendCaptureSuccess(
                        chosenText,
                        chosenLines,
                        iconDetection,
                        debugCropPaths,
                      )
                      scaledFocusedBitmap.recycle()
                      scaledStatsBitmap.recycle()
                      statsBitmap.recycle()
                      focusedBitmap.recycle()
                      croppedBitmap.recycle()
                      paddedBitmap.recycle()
                      image.close()
                      isCapturing = false
                      mainHandler.post { restoreIdleOverlayState() }
                    },
                    onFailure = { error ->
                      sendCaptureError(error.message ?: "Unable to read text from the captured mod.")
                      scaledFocusedBitmap.recycle()
                      scaledStatsBitmap.recycle()
                      statsBitmap.recycle()
                      focusedBitmap.recycle()
                      croppedBitmap.recycle()
                      paddedBitmap.recycle()
                      image.close()
                      isCapturing = false
                    }
                  )
                }
              },
              onFailure = { error ->
                sendCaptureError(error.message ?: "Unable to read text from the captured mod.")
                scaledFocusedBitmap.recycle()
                scaledStatsBitmap.recycle()
                statsBitmap.recycle()
                focusedBitmap.recycle()
                croppedBitmap.recycle()
                paddedBitmap.recycle()
                image.close()
                isCapturing = false
              }
            )
          }
        )
      } catch (error: Exception) {
        sendCaptureError(error.message ?: "Unknown screenshot capture failure.")
        isCapturing = false
      }
    }, 350)
  }

  private fun ensureCaptureSession(
    projection: MediaProjection,
    displayMetrics: DisplayMetrics,
    handler: Handler,
  ): Boolean {
    val width = displayMetrics.widthPixels
    val height = displayMetrics.heightPixels
    val densityDpi = displayMetrics.densityDpi

    if (
      captureVirtualDisplay != null &&
      captureImageReader != null &&
      captureWidth == width &&
      captureHeight == height &&
      captureDensityDpi == densityDpi
    ) {
      return true
    }

    if (captureVirtualDisplay != null && captureImageReader != null) {
      return true
    }

    return try {
      val imageReader = ImageReader.newInstance(
        width,
        height,
        PixelFormat.RGBA_8888,
        2,
      )
      val virtualDisplay = projection.createVirtualDisplay(
        "ModOverlayCapture",
        width,
        height,
        densityDpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        imageReader.surface,
        null,
        handler,
      )
      captureImageReader = imageReader
      captureVirtualDisplay = virtualDisplay
      captureWidth = width
      captureHeight = height
      captureDensityDpi = densityDpi
      true
    } catch (error: Exception) {
      Log.e(logTag, "ensureCaptureSession: failed", error)
      clearProjectionPermission(this)
      clearMediaProjection()
      releaseCaptureSession()
      false
    }
  }

  private fun primeProjectionIfPossible() {
    ensureProjectionPermissionLoaded(this)
    val resultCode = projectionResultCode ?: return
    val resultData = projectionDataIntent ?: return

    if (mediaProjection != null) {
      return
    }

    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
      )
      getOrCreateMediaProjection(resultCode, resultData)
      Log.d(logTag, "primeProjectionIfPossible: projection primed")
    } catch (error: Exception) {
      Log.e(logTag, "primeProjectionIfPossible: failed", error)
      clearProjectionPermission(this)
      clearMediaProjection()
      restoreIdleOverlayState()
    }
  }

  private fun getOrCreateMediaProjection(resultCode: Int, resultData: Intent): MediaProjection? {
    mediaProjection?.let { return it }

    val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
      ?: return null

    return try {
      Log.d(logTag, "getOrCreateMediaProjection: creating projection")
      projectionManager.getMediaProjection(resultCode, resultData).also { projection ->
        val callback = object : MediaProjection.Callback() {
          override fun onStop() {
            Log.d(logTag, "getOrCreateMediaProjection: projection stopped")
            clearProjectionPermission(this@ModOverlayCaptureService)
            clearMediaProjection()
          }
        }
        val handler = captureHandler
        if (handler != null) {
          projection.registerCallback(callback, handler)
        } else {
          projection.registerCallback(callback, null)
        }
        mediaProjection = projection
        mediaProjectionCallback = callback
      }
    } catch (error: Exception) {
      Log.e(logTag, "getOrCreateMediaProjection: failed", error)
      clearProjectionPermission(this)
      null
    }
  }

  private fun clearMediaProjection() {
    releaseCaptureSession()
    try {
      mediaProjectionCallback?.let { callback ->
        mediaProjection?.unregisterCallback(callback)
      }
    } catch (_: Exception) {
    }

    try {
      mediaProjection?.stop()
    } catch (_: Exception) {
    }

    mediaProjection = null
    mediaProjectionCallback = null
  }

  private fun releaseCaptureSession() {
    try {
      captureVirtualDisplay?.release()
    } catch (_: Exception) {
    }
    try {
      captureImageReader?.close()
    } catch (_: Exception) {
    }
    captureVirtualDisplay = null
    captureImageReader = null
    captureWidth = 0
    captureHeight = 0
    captureDensityDpi = 0
  }

  private fun cropForModCard(source: Bitmap): Bitmap {
    val width = source.width
    val height = source.height

    val left = (width * 0.06f).toInt().coerceIn(0, width - 1)
    val top = (height * 0.12f).toInt().coerceIn(0, height - 1)
    val cropWidth = (width * 0.88f).toInt().coerceAtLeast(1).coerceAtMost(width - left)
    val cropHeight = (height * 0.76f).toInt().coerceAtLeast(1).coerceAtMost(height - top)

    return Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
  }

  private fun cropForStatsPanel(source: Bitmap): Bitmap {
    val width = source.width
    val height = source.height
    val left = (width * 0.47f).toInt().coerceIn(0, width - 1)
    val top = (height * 0.12f).toInt().coerceIn(0, height - 1)
    val cropWidth = (width * 0.26f).toInt().coerceAtLeast(1).coerceAtMost(width - left)
    val cropHeight = (height * 0.50f).toInt().coerceAtLeast(1).coerceAtMost(height - top)
    return Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
  }

  private fun cropForIconRegion(source: Bitmap): Bitmap {
    val width = source.width
    val height = source.height
    val left = (width * 0.395f).toInt().coerceIn(0, width - 1)
    val top = (height * 0.105f).toInt().coerceIn(0, height - 1)
    val cropWidth = (width * 0.16f).toInt().coerceAtLeast(1).coerceAtMost(width - left)
    val cropHeight = (height * 0.22f).toInt().coerceAtLeast(1).coerceAtMost(height - top)
    return Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
  }

  private fun cropForShapeDebug(source: Bitmap): Bitmap {
    val width = source.width
    val height = source.height
    val left = (width * 0.375f).toInt().coerceIn(0, width - 1)
    val top = (height * 0.145f).toInt().coerceIn(0, height - 1)
    val cropWidth = (width * 0.14f).toInt().coerceAtLeast(1).coerceAtMost(width - left)
    val cropHeight = (height * 0.21f).toInt().coerceAtLeast(1).coerceAtMost(height - top)
    return Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
  }

  private fun cropForSetSymbol(source: Bitmap): Bitmap {
    // Matches ModIconClassifier.cropSetSymbolVariants("arrow") primary variant
    // so the saved -set.png training sample is the same region the classifier
    // evaluates at inference time.
    val width = source.width
    val height = source.height
    val left = (width * 0.12f).toInt().coerceIn(0, width - 1)
    val top = (height * 0.20f).toInt().coerceIn(0, height - 1)
    val cropWidth = (width * 0.44f).toInt().coerceAtLeast(1).coerceAtMost(width - left)
    val cropHeight = (height * 0.50f).toInt().coerceAtLeast(1).coerceAtMost(height - top)
    return Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
  }

  private fun scaleForOcr(source: Bitmap, factor: Int = 3): Bitmap {
    return Bitmap.createScaledBitmap(
      source,
      (source.width * factor).coerceAtLeast(1),
      (source.height * factor).coerceAtLeast(1),
      true,
    )
  }

  private fun saveDebugBitmap(label: String, bitmap: Bitmap): String? {
    return try {
      val debugDir = File(cacheDir, "overlay-debug").apply {
        if (!exists()) mkdirs()
      }
      val outputFile = File(debugDir, "${System.currentTimeMillis()}-$label.png")
      FileOutputStream(outputFile).use { stream ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
      }
      if (label == "set" || label == "icon") {
        try {
          val externalDir = getExternalFilesDir(null)
          if (externalDir != null) {
            val externalFile = File(externalDir, "$label-debug-last.png")
            FileOutputStream(externalFile).use { stream ->
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
          }
        } catch (_: Throwable) {}
      }
      outputFile.absolutePath
    } catch (_: Exception) {
      null
    }
  }

  private fun mergeOcrText(primary: String, secondary: String): String {
    return listOf(primary.trim(), secondary.trim())
      .filter { it.isNotEmpty() }
      .distinct()
      .joinToString("\n")
  }

  private fun mergeOcrLines(primary: ArrayList<String>, secondary: ArrayList<String>): ArrayList<String> {
    val merged = LinkedHashSet<String>()
    primary.mapTo(merged) { it.trim() }
    secondary.mapTo(merged) { it.trim() }
    return ArrayList(merged.filter { it.isNotEmpty() })
  }

  private fun isRecognitionStrongEnough(text: String, lines: ArrayList<String>, expectStatsPanel: Boolean = false): Boolean {
    val lower = text.lowercase()
    if (expectStatsPanel) {
      val hasPrimary = lower.contains("primary") || PRIMARY_STAT_HINTS.any { lower.contains(it) }
      val secondaryHits = SECONDARY_STAT_HINTS.count { lower.contains(it) }
      val hasSecondary = lower.contains("secondary") || lines.size >= 4 || secondaryHits >= 2
      if (hasPrimary && hasSecondary) return true
    }
    if (text.length >= 80) return true
    if (lines.size >= 6) return true
    return false
  }

  private fun recognizeBitmap(
    bitmap: Bitmap,
    onSuccess: (String, ArrayList<String>) -> Unit,
    onFailure: (Exception) -> Unit,
  ) {
    Log.d(logTag, "recognizeBitmap: starting ${bitmap.width}x${bitmap.height}")
    val inputImage = InputImage.fromBitmap(bitmap, 0)

    val bgHandler = captureHandler
    // Dispatch OCR callbacks onto the capture thread so the heavy shape
    // classifier work that follows does not block the main UI thread
    // (otherwise the scanning dots animation stalls until the scan finishes).
    textRecognizer.process(inputImage)
      .addOnSuccessListener { visionText ->
        val ocrLines = ArrayList<String>().apply {
          visionText.textBlocks.forEach { block ->
            block.lines.forEach { line ->
              add(line.text)
            }
          }
        }
        Log.d(logTag, "recognizeBitmap: success chars=${visionText.text.length} lines=${ocrLines.size}")
        val dispatch = Runnable { onSuccess(visionText.text, ocrLines) }
        if (bgHandler != null) bgHandler.post(dispatch) else dispatch.run()
      }
      .addOnFailureListener { error ->
        Log.e(logTag, "recognizeBitmap: failed", error)
        val dispatch = Runnable { onFailure(Exception(error)) }
        if (bgHandler != null) bgHandler.post(dispatch) else dispatch.run()
      }
  }

  private fun sendCaptureSuccess(
    text: String,
    lines: ArrayList<String>,
    iconDetection: ModIconClassifier.Detection?,
    debugCropPaths: DebugCropPaths,
  ) {
    stopScanningAnimation()
    val normalizedPrimary = extractNormalizedPrimaryFromOcr(text, lines).normalizedPrimary
    val validatedShape = normalizeDetectedShape(iconDetection, normalizedPrimary)
    val normalizedSet = if (OUTER_SHAPE_TRAINING_MODE) null else normalizeDetectedSet(iconDetection)
    Log.d(
      logTag,
      "sendCaptureSuccess: chars=${text.length} lines=${lines.size} shape=${validatedShape ?: iconDetection?.shape} set=${normalizedSet ?: if (OUTER_SHAPE_TRAINING_MODE) null else iconDetection?.setName}"
    )
    val topSetDebug = iconDetection?.topSetMatches?.take(5)?.joinToString(", ") { "${it.name}:${"%.3f".format(it.score)}" }
    Log.d(logTag, "sendCaptureSuccess: topSet=[$topSetDebug]")
    val topShapeDebug = iconDetection?.topShapeMatches?.take(5)?.joinToString(", ") { "${it.name}:${"%.3f".format(it.score)}" }
    Log.d(logTag, "sendCaptureSuccess: topShape=[$topShapeDebug]")
    Log.d(logTag, "sendCaptureSuccess: ocrText=${text.replace("\n", " | ")}")
    try {
      val outDir = getExternalFilesDir(null)
      if (outDir != null) {
        val dump = buildString {
          append("lines=${lines.size}\n")
          append("shape=${validatedShape ?: iconDetection?.shape}\n")
          append("set=${normalizedSet ?: iconDetection?.setName}\n")
          append("---RAW---\n")
          append(text)
          append("\n---LINES---\n")
          lines.forEachIndexed { i, line -> append("[$i] $line\n") }
        }
        java.io.File(outDir, "ocr-debug-last.txt").writeText(dump)
      }
    } catch (_: Throwable) { /* debug dump is best-effort */ }
    val preview = buildCapturePreview(text, lines, iconDetection)
    val shapeForUi = validatedShape ?: iconDetection?.shape
    val isArrow = shapeForUi?.equals("Arrow", ignoreCase = true) == true
    mainHandler.post {
      if (DEBUG_READOUT_MODE || OUTER_SHAPE_TRAINING_MODE) {
        showRecommendationOverlay(
          "Capture Read",
          preview,
          includeShapeActions = OUTER_SHAPE_TRAINING_MODE,
        )
      } else {
        hideRecommendationOverlay()
      }
      if (ARROW_SET_TRAINING_MODE) {
        showArrowTrainingOverlay()
      } else {
        hideArrowTrainingOverlay()
      }
    }
    LocalBroadcastManager.getInstance(this).sendBroadcast(
      Intent(ACTION_CAPTURE_SUCCESS).apply {
        putExtra(EXTRA_CAPTURE_TIMESTAMP, System.currentTimeMillis())
        putExtra(EXTRA_CAPTURE_TEXT, text)
        putStringArrayListExtra(EXTRA_CAPTURE_LINES, lines)
        putExtra(EXTRA_CAPTURE_SHAPE, validatedShape ?: iconDetection?.shape)
        putExtra(EXTRA_CAPTURE_SET, normalizedSet ?: if (OUTER_SHAPE_TRAINING_MODE) null else iconDetection?.setName)
        putStringArrayListExtra(
          EXTRA_CAPTURE_TOP_SHAPE_MATCHES,
          ArrayList(iconDetection?.topShapeMatches?.map { "${it.name}: ${"%.3f".format(it.score)}" } ?: emptyList())
        )
        run {
          val variantMap = iconDetection?.variantShapeMatches.orEmpty()
          if (variantMap.isNotEmpty()) {
            val obj = org.json.JSONObject()
            variantMap.forEach { (label, matches) ->
              val arr = org.json.JSONArray()
              matches.forEach { m ->
                arr.put(org.json.JSONObject().apply {
                  put("name", m.name)
                  put("score", m.score)
                })
              }
              obj.put(label, arr)
            }
            putExtra(EXTRA_CAPTURE_VARIANT_SHAPE_MATCHES_JSON, obj.toString())
          }
        }
        putStringArrayListExtra(
          EXTRA_CAPTURE_TOP_SET_MATCHES,
          ArrayList(
            if (OUTER_SHAPE_TRAINING_MODE) {
              emptyList()
            } else {
              iconDetection?.topSetMatches?.map { "${it.name}: ${"%.3f".format(it.score)}" } ?: emptyList()
            }
          )
        )
        putExtra(EXTRA_CAPTURE_FOCUSED_PATH, debugCropPaths.focusedPath)
        putExtra(EXTRA_CAPTURE_STATS_PATH, debugCropPaths.statsPath)
        putExtra(EXTRA_CAPTURE_SHAPE_PATH, debugCropPaths.shapePath)
        putExtra(EXTRA_CAPTURE_ICON_PATH, debugCropPaths.iconPath)
        putExtra(EXTRA_CAPTURE_SET_PATH, debugCropPaths.setPath)
      }
    )
  }

  private fun sendCaptureError(message: String) {
    Log.e(logTag, "sendCaptureError: $message")
    stopScanningAnimation()
    isCapturing = false
    mainHandler.post {
      restoreIdleOverlayState()
      showRecommendationOverlay("Scan Failed", message)
    }
    LocalBroadcastManager.getInstance(this).sendBroadcast(
      Intent(ACTION_CAPTURE_ERROR).apply {
        putExtra(EXTRA_CAPTURE_ERROR, message)
        putExtra(EXTRA_CAPTURE_TIMESTAMP, System.currentTimeMillis())
      }
    )
  }

  private fun buildCapturePreview(
    text: String,
    lines: ArrayList<String>,
    iconDetection: ModIconClassifier.Detection?,
  ): String {
    val ocrExtraction = extractNormalizedPrimaryFromOcr(text, lines)
    val normalizedRawLines = ocrExtraction.normalizedRawLines
    val cleanedText = ocrExtraction.cleanedText
    val cleanedLines = ocrExtraction.cleanedLines
    val secondaryIndex = ocrExtraction.secondaryIndex
    val primaryLine = ocrExtraction.primaryLine
    val normalizedPrimary = ocrExtraction.normalizedPrimary
    val validatedShape = normalizeDetectedShape(iconDetection, normalizedPrimary)
    val validatedSet = if (OUTER_SHAPE_TRAINING_MODE) null else normalizeDetectedSet(iconDetection)

    val labeledShell = listOf(
      "Set: ${validatedSet ?: if (OUTER_SHAPE_TRAINING_MODE) "Training Outer Shape" else "Unknown"}",
      "Shape: ${validatedShape ?: "Unknown"}",
    ).joinToString(" • ")

    val secondaryCandidateLines = if (secondaryIndex != -1) {
      normalizedRawLines.drop(secondaryIndex + 1)
    } else {
      cleanedLines
    }

    val secondaryLines = secondaryCandidateLines
      .filterNot { it == primaryLine }
      .filter { line ->
        val lower = line.lowercase()
        Regex("""\(\d+\)""").containsMatchIn(lower) ||
          lower.contains("speed") ||
          lower.contains("potency") ||
          lower.contains("tenacity") ||
          lower.contains("crit") ||
          lower.contains("offense") ||
          lower.contains("defense") ||
          lower.contains("health") ||
          lower.contains("protection")
      }
      .map { normalizePreviewLine(it) }
      .take(4)

    val regexSecondaryLines = extractSecondaryPreviewLines(cleanedText)
    val mergedSecondaryLines = (secondaryLines + regexSecondaryLines)
      .map { normalizePreviewLine(it) }
      .filter { it.isNotBlank() }
      .distinct()
      .take(4)

    val previewLines = mutableListOf<String>()
    if (normalizedPrimary.isNotBlank()) {
      previewLines += "Primary: $normalizedPrimary"
    }
    if (mergedSecondaryLines.isNotEmpty()) {
      previewLines += "Secondaries:"
      previewLines += mergedSecondaryLines.map { "• $it" }
    }

    return listOfNotNull(
      labeledShell,
      if (previewLines.isNotEmpty()) previewLines.joinToString("\n") else null,
    ).joinToString("\n")
  }

  private fun extractSecondaryPreviewLines(cleanedText: String): List<String> {
    val regex = Regex("""\((\d+)\)\s*([+-]?\d+(?:\.\d+)?%?)\s*([A-Za-z% ]{2,})""")
    return regex.findAll(cleanedText)
      .map { match ->
        val rolls = match.groupValues[1]
        val value = match.groupValues[2]
        val stat = normalizePreviewLine(match.groupValues[3])
        "($rolls) $value $stat".trim()
      }
      .toList()
  }

  private fun normalizePreviewLine(input: String): String {
    return input
      .replace(Regex("""(?i)\btency\b"""), "Potency%")
      .replace(Regex("""(?i)\btency%\b"""), "Potency%")
      .replace(Regex("""(?i)\bspe\b"""), "Speed")
      .replace(Regex("""(?i)\bspd\b"""), "Speed")
      .replace(Regex("""(?i)\bdee\b"""), "Defense%")
      .replace(Regex("""(?i)\bdefe\w*\b"""), "Defense%")
      .replace(Regex("""(?i)\bdef\b"""), "Defense")
      .replace(Regex("""(?i)\btenac\w*\b"""), "Tenacity%")
      .replace(Regex("""(?i)\bpoten\w*\b"""), "Potency%")
      .replace(Regex("""(?i)\bprot\w*\b"""), "Protection%")
      .replace(Regex("""(?i)\bcrit chance\b(?!%)"""), "Crit Chance%")
      .replace(Regex("""(?i)\bcrit dmg\b(?!%)"""), "Crit Dmg%")
      .replace(Regex("""(?i)\bdefense\b(?!%)"""), "Defense")
      .replace(Regex("""(?i)\bhealth\b(?!%)"""), "Health")
      .replace(Regex("""(?i)\bprotection\b(?!%)"""), "Protection")
      .replace(Regex("""(?i)\boffense\b(?!%)"""), "Offense")
      .replace(Regex("""\s+"""), " ")
      .trim()
  }

  private data class OcrPrimaryExtraction(
    val normalizedRawLines: List<String>,
    val cleanedText: String,
    val cleanedLines: List<String>,
    val primaryLine: String,
    val normalizedPrimary: String,
    val secondaryIndex: Int,
  )

  private fun extractNormalizedPrimaryFromOcr(text: String, lines: List<String>): OcrPrimaryExtraction {
    val normalizedRawLines = mergeBrokenPreviewLines(
      lines
        .map { line ->
          line
            .replace(Regex("(?i)reading the visible primary and secondary stats\\.?"), " ")
            .replace(Regex("(?i)scanning mod\\.{0,3}"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        }
        .filter { it.isNotBlank() }
    )
    val cleanedText = text
      .replace(Regex("(?i)reading the visible primary and secondary stats\\.?"), " ")
      .replace(Regex("(?i)scanning mod\\.{0,3}"), " ")
      .replace(Regex("\\s+"), " ")
      .trim()
    val cleanedLines = normalizedRawLines
      .filter { it.isNotBlank() }
      .filterNot { line ->
        val lower = line.lowercase()
        lower.contains("primary stat") ||
          lower.contains("secondary stat") ||
          lower == "a stat"
      }
      .take(8)
    val primaryIndex = normalizedRawLines.indexOfFirst { it.contains("PRIMARY", ignoreCase = true) }
    val secondaryIndex = normalizedRawLines.indexOfFirst { it.contains("SECONDARY", ignoreCase = true) }
    val primaryLine = if (primaryIndex != -1) {
      normalizedRawLines
        .drop(primaryIndex + 1)
        .take(if (secondaryIndex > primaryIndex) secondaryIndex - primaryIndex - 1 else 3)
        .firstOrNull { line ->
          !line.contains("PRIMARY", ignoreCase = true) &&
            !line.contains("SECONDARY", ignoreCase = true) &&
            !Regex("""\(\d+\)""").containsMatchIn(line)
        }
    } else {
      cleanedLines.firstOrNull { line ->
        !Regex("""\(\d+\)""").containsMatchIn(line)
      }
    } ?: cleanedText.take(60)

    return OcrPrimaryExtraction(
      normalizedRawLines = normalizedRawLines,
      cleanedText = cleanedText,
      cleanedLines = cleanedLines,
      primaryLine = primaryLine,
      normalizedPrimary = normalizePreviewLine(primaryLine),
      secondaryIndex = secondaryIndex,
    )
  }

  private fun preferredSetProfileFromOcr(text: String, lines: List<String>): String? {
    val extraction = extractNormalizedPrimaryFromOcr(text, lines)
    val normalizedPrimary = extraction.normalizedPrimary.lowercase()
    val normalizedLines = extraction.cleanedLines.map(::normalizePreviewLine).map { it.lowercase() }
    val normalizedText = normalizePreviewLine(extraction.cleanedText).lowercase()
    val combined = buildString {
      append(normalizedText)
      append('\n')
      append(normalizedPrimary)
      normalizedLines.forEach { line ->
        append('\n')
        append(line)
      }
    }
    val primarySpeedValue = Regex("""^\+?\d{1,2}$""").matches(normalizedPrimary) &&
      normalizedPrimary.replace("+", "").toIntOrNull()?.let { it in 20..40 } == true

    return when {
      primarySpeedValue -> "arrow"
      else -> null
    }
  }

  private fun normalizeDetectedShape(iconDetection: ModIconClassifier.Detection?, primary: String): String? {
    val strongTopShape = pickRankedMatch(
      iconDetection?.topShapeMatches.orEmpty(),
      minimumScore = 0.18,
      minimumMargin = 0.012,
      strongScore = 0.26,
    )
    if (strongTopShape != null) {
      return strongTopShape.trim()
    }

    val normalizedShape = iconDetection?.shape?.trim()?.takeIf { it.isNotBlank() } ?: return null
    return normalizedShape
  }

  private fun normalizeDetectedSet(iconDetection: ModIconClassifier.Detection?): String? {
    val direct = iconDetection?.setName?.trim()?.takeIf { it.isNotBlank() }
    if (direct != null) return direct
    return pickRankedMatch(
      iconDetection?.topSetMatches.orEmpty(),
      minimumScore = 0.13,
      minimumMargin = 0.01,
      strongScore = 0.18,
    )?.trim()
  }

  private fun pickRankedMatch(
    matches: List<ModIconClassifier.MatchScore>,
    minimumScore: Double,
    minimumMargin: Double,
    strongScore: Double,
  ): String? {
    val best = matches.firstOrNull() ?: return null
    val secondScore = matches.getOrNull(1)?.score ?: 0.0
    val margin = best.score - secondScore
    if (best.score >= strongScore) return best.name
    if (best.score >= minimumScore && margin >= minimumMargin) return best.name
    return null
  }

  private fun mergeBrokenPreviewLines(lines: List<String>): List<String> {
    if (lines.isEmpty()) return emptyList()

    val merged = mutableListOf<String>()
    var index = 0
    while (index < lines.size) {
      val current = lines[index]
      val next = lines.getOrNull(index + 1)

      val shouldMergeChain =
        Regex("""^\(\d+\)\s*[+-]?\d+(?:\.\d+)?%?$""").containsMatchIn(current)

      if (shouldMergeChain) {
        val parts = mutableListOf(current)
        var lookahead = index + 1
        while (lookahead < lines.size) {
          val candidate = lines[lookahead]
          val candidateLower = candidate.lowercase()
          val startsNewStat = Regex("""^\(\d+\)""").containsMatchIn(candidate)
          val isSectionLabel = candidateLower.contains("primary") || candidateLower.contains("secondary")
          if (startsNewStat || isSectionLabel) {
            break
          }
          parts += candidate
          lookahead += 1
          if (parts.size >= 3) break
        }

        merged += parts.joinToString(" ").trim()
        index = lookahead
        continue
      }

      merged += current
      index += 1
    }

    return merged
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      NOTIFICATION_CHANNEL_ID,
      getString(R.string.mod_overlay_notification_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.mod_overlay_notification_channel_description)
      setShowBadge(false)
    }

    notificationManager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val stopIntent = Intent(this, ModOverlayCaptureService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPendingIntent = PendingIntent.getService(
      this,
      1002,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
      .setContentTitle(getString(R.string.mod_overlay_notification_title))
      .setContentText(getString(R.string.mod_overlay_notification_text))
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setSilent(true)
      // Tapping the notification body now stops the overlay directly — no
      // need to expand the notification and hunt for the Close action button.
      .setContentIntent(stopPendingIntent)
      .addAction(
        0,
        getString(R.string.mod_overlay_notification_stop_action),
        stopPendingIntent,
      )
      .build()
  }

  companion object {
    const val ACTION_START = "com.hungrr13.modhelper.overlay.START"
    const val ACTION_STOP = "com.hungrr13.modhelper.overlay.STOP"
    const val ACTION_CAPTURE_TAPPED = "com.hungrr13.modhelper.overlay.CAPTURE_TAPPED"
    const val ACTION_CAPTURE_SUCCESS = "com.hungrr13.modhelper.overlay.CAPTURE_SUCCESS"
    const val ACTION_CAPTURE_ERROR = "com.hungrr13.modhelper.overlay.CAPTURE_ERROR"
    const val ACTION_CONFIRM_ARROW_BURST = "com.hungrr13.modhelper.overlay.CONFIRM_ARROW_BURST"
    const val ACTION_CONFIRM_OUTER_SHAPE = "com.hungrr13.modhelper.overlay.CONFIRM_OUTER_SHAPE"
    const val ACTION_SHOW_RECOMMENDATION = "com.hungrr13.modhelper.overlay.SHOW_RECOMMENDATION"
    const val ACTION_SHOW_DUAL_RECOMMENDATION = "com.hungrr13.modhelper.overlay.SHOW_DUAL_RECOMMENDATION"
    const val ACTION_HIDE_RECOMMENDATION = "com.hungrr13.modhelper.overlay.HIDE_RECOMMENDATION"
    const val ACTION_PRIME_PROJECTION = "com.hungrr13.modhelper.overlay.PRIME_PROJECTION"
    const val ACTION_WARM_ONLY = "com.hungrr13.modhelper.overlay.WARM_ONLY"
    const val EXTRA_CAPTURE_PATH = "capturePath"
    const val EXTRA_CAPTURE_TEXT = "captureText"
    const val EXTRA_CAPTURE_LINES = "captureLines"
    const val EXTRA_CAPTURE_SHAPE = "captureShape"
    const val EXTRA_CAPTURE_SET = "captureSet"
    const val EXTRA_CAPTURE_TOP_SHAPE_MATCHES = "captureTopShapeMatches"
    const val EXTRA_CAPTURE_VARIANT_SHAPE_MATCHES_JSON = "captureVariantShapeMatchesJson"
    const val EXTRA_CAPTURE_TOP_SET_MATCHES = "captureTopSetMatches"
    const val EXTRA_CAPTURE_FOCUSED_PATH = "captureFocusedPath"
    const val EXTRA_CAPTURE_STATS_PATH = "captureStatsPath"
    const val EXTRA_CAPTURE_SHAPE_PATH = "captureShapePath"
    const val EXTRA_CAPTURE_ICON_PATH = "captureIconPath"
    const val EXTRA_CAPTURE_SET_PATH = "captureSetPath"
    const val EXTRA_CAPTURE_ERROR = "captureError"
    const val EXTRA_CAPTURE_TIMESTAMP = "captureTimestamp"
    const val EXTRA_CONFIRMED_SET = "confirmedSet"
    const val EXTRA_CONFIRMED_SHAPE = "confirmedShape"
    const val EXTRA_RECOMMENDATION_TITLE = "recommendationTitle"
    const val EXTRA_RECOMMENDATION_BODY = "recommendationBody"
    const val EXTRA_CHARACTER_TITLE = "characterTitle"
    const val EXTRA_CHARACTER_BODY = "characterBody"
    private const val NOTIFICATION_ID = 1001
    private const val NOTIFICATION_CHANNEL_ID = "mod_overlay_capture"
    private const val PREFS_NAME = "mod_overlay_capture"
    private const val PREF_PROJECTION_RESULT_CODE = "projectionResultCode"
    private const val PREF_PROJECTION_DATA_URI = "projectionDataUri"
    private val FORCED_DEBUG_SET_PROFILE: String? = null
    private const val OUTER_SHAPE_TRAINING_MODE: Boolean = false
    // Set to a profile name ("arrow", "triangle", "generic") to show the
    // 8-button set labeling overlay after every scan and save crops under
    // files/<profile>-training/<slug>/. Null disables training mode.
    private val SET_TRAINING_PROFILE: String? = null
    private val ARROW_SET_TRAINING_MODE: Boolean get() = SET_TRAINING_PROFILE != null
    // Flip to true to show the detailed scan readout (OCR text + shape/set
    // matches + scores) in the on-screen popup. Useful when a shape or set
    // is misreading. When false, the visible popup is suppressed so the
    // cleaner slice/character recommendation UI can take over.
    private const val DEBUG_READOUT_MODE: Boolean = false
    private val PRIMARY_STAT_HINTS = listOf("health", "protection", "speed", "offense", "defense")
    private val SECONDARY_STAT_HINTS = listOf(
      "speed",
      "health",
      "protection",
      "offense",
      "defense",
      "crit chance",
      "crit dmg",
      "potency",
      "tenacity",
      "accuracy"
    )
    private var projectionResultCode: Int? = null
    private var projectionDataIntent: Intent? = null

    @Volatile
    var isRunning: Boolean = false

    @Volatile
    var isBubbleVisible: Boolean = false

    @Volatile
    var isWarmedUp: Boolean = false

    private val pendingWarmCallbacks = java.util.concurrent.CopyOnWriteArrayList<Runnable>()

    fun awaitWarmUp(callback: Runnable) {
      if (isWarmedUp) {
        callback.run()
      } else {
        pendingWarmCallbacks.add(callback)
      }
    }

    fun markWarmedUp() {
      isWarmedUp = true
      val callbacks = pendingWarmCallbacks.toList()
      pendingWarmCallbacks.clear()
      callbacks.forEach { it.run() }
    }

    private fun ensureProjectionPermissionLoaded(context: Context) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      if (
        prefs.contains(PREF_PROJECTION_RESULT_CODE) ||
        prefs.contains(PREF_PROJECTION_DATA_URI)
      ) {
        prefs.edit()
          .remove(PREF_PROJECTION_RESULT_CODE)
          .remove(PREF_PROJECTION_DATA_URI)
          .apply()
      }
    }

    fun setProjectionPermission(context: Context, resultCode: Int, data: Intent) {
      projectionResultCode = resultCode
      projectionDataIntent = Intent(data)
    }

    fun clearProjectionPermission(context: Context) {
      projectionResultCode = null
      projectionDataIntent = null
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .remove(PREF_PROJECTION_RESULT_CODE)
        .remove(PREF_PROJECTION_DATA_URI)
        .apply()
    }

    fun hasProjectionPermission(context: Context? = null): Boolean {
      if (context != null) ensureProjectionPermissionLoaded(context)
      return projectionResultCode != null && projectionDataIntent != null
    }
  }
}
