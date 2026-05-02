package com.hungrr13.modhelper.overlay

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.imgproc.Imgproc

class ModTierClassifier(private val context: Context) {
  data class MatchScore(val name: String, val score: Double)

  data class TierDetection(
    val tier: String?,         // "5E".."5A" / "6E".."6A" / null
    val tierLetter: String?,   // "E".."A" / null
    val dots: Int,             // 5 or 6 (0 if unknown)
    val tierScore: Double,     // [0..1] color match confidence
    val pipScore: Double,      // [0..1] pip count confidence
    val topMatches: List<MatchScore>,
  )

  // Per-tier HSV envelope. OpenCV ranges: H 0..180, S 0..255, V 0..255.
  // The tier signal is the INTERIOR FILL of the icon shape: cyan / green /
  // blue / purple / gold for E / D / C / B / A. Hue bands are kept tight
  // and disjoint so cyan (E) and blue (C) don't bleed into each other.
  private data class TierProfile(
    val name: String,
    val hLo: Int, val hHi: Int,
    val sLo: Int, val sHi: Int,
    val vLo: Int, val vHi: Int,
  )

  private val tierProfiles = listOf(
    TierProfile("A", 12, 33, 100, 255, 110, 255),
    TierProfile("D", 38, 72, 80, 255, 60, 240),
    // SWGOH "cyan" (5E) and "blue" (5C) share nearly the same hue
    // (sampled: 5E H=102, 5C H=107) but differ sharply in saturation
    // (5E avg S=116, 5C avg S=186). Split by S, not H.
    TierProfile("E", 92, 122, 60, 155, 60, 220),
    TierProfile("C", 92, 130, 155, 255, 80, 240),
    TierProfile("B", 130, 160, 70, 255, 60, 240),
  )

  fun classify(focusedBitmap: Bitmap): TierDetection {
    return try {
      val color = classifyTierColor(focusedBitmap)
      val pip = classifyPipCount(focusedBitmap)
      val tier = color.letter?.let { letter ->
        val prefix = if (pip.first == 6) "6" else "5"
        "$prefix$letter"
      }
      TierDetection(
        tier = tier,
        tierLetter = color.letter,
        dots = pip.first,
        tierScore = color.score,
        pipScore = pip.second,
        topMatches = color.allMatches,
      )
    } catch (t: Throwable) {
      Log.w(TAG, "ModTierClassifier.classify failed", t)
      TierDetection(null, null, 0, 0.0, 0.0, emptyList())
    }
  }

  private data class TierColorResult(
    val letter: String?,
    val score: Double,
    val allMatches: List<MatchScore>,
  )

  private fun classifyTierColor(card: Bitmap): TierColorResult {
    // The shape frame box sits at left=0.410 top=0.131 w=0.075 h=0.191 of
    // the focused card. The TIER signal is the colored fill INSIDE that
    // shape (cyan/green/blue/purple/gold for E/D/C/B/A). Sample the inner
    // 0.85 box and count pixels by hue against each tier profile.
    val w = card.width
    val h = card.height
    val cx = w * (0.410f + 0.075f / 2f)
    val cy = h * (0.131f + 0.191f / 2f)
    val sampleW = w * 0.075f * INTERIOR_SCALE
    val sampleH = h * 0.191f * INTERIOR_SCALE
    val left = (cx - sampleW / 2f).toInt().coerceIn(0, w - 1)
    val top = (cy - sampleH / 2f).toInt().coerceIn(0, h - 1)
    val right = (cx + sampleW / 2f).toInt().coerceIn(left + 1, w)
    val bottom = (cy + sampleH / 2f).toInt().coerceIn(top + 1, h)

    val crop = Bitmap.createBitmap(card, left, top, right - left, bottom - top)
    val rgba = Mat()
    Utils.bitmapToMat(crop, rgba)
    val rgb = Mat()
    Imgproc.cvtColor(rgba, rgb, Imgproc.COLOR_RGBA2RGB)
    val hsv = Mat()
    Imgproc.cvtColor(rgb, hsv, Imgproc.COLOR_RGB2HSV)

    // Saturated, mid-bright pixels — the tier-color fill. Drops the dark
    // outline on the inside of the frame and the ultra-bright highlights
    // of the set-symbol overlay.
    val saturatedMask = Mat()
    Core.inRange(
      hsv,
      Scalar(0.0, MIN_INTERIOR_S.toDouble(), MIN_INTERIOR_V.toDouble()),
      Scalar(180.0, 255.0, MAX_INTERIOR_V.toDouble()),
      saturatedMask,
    )
    val saturatedCount = Core.countNonZero(saturatedMask).toDouble()

    val matches = tierProfiles.map { profile ->
      val inRange = Mat()
      Core.inRange(
        hsv,
        Scalar(profile.hLo.toDouble(), profile.sLo.toDouble(), profile.vLo.toDouble()),
        Scalar(profile.hHi.toDouble(), profile.sHi.toDouble(), profile.vHi.toDouble()),
        inRange,
      )
      Core.bitwise_and(inRange, saturatedMask, inRange)
      val matched = Core.countNonZero(inRange).toDouble()
      inRange.release()
      val score = if (saturatedCount > 0.0) matched / saturatedCount else 0.0
      MatchScore(profile.name, score)
    }.sortedByDescending { it.score }

    rgba.release(); rgb.release(); hsv.release(); saturatedMask.release()
    crop.recycle()

    val winner = matches.first()
    val runnerUp = matches.getOrNull(1)
    val margin = winner.score - (runnerUp?.score ?: 0.0)
    val confident = winner.score >= MIN_TIER_SCORE && margin >= MIN_TIER_MARGIN
    return TierColorResult(
      letter = if (confident) winner.name else null,
      score = winner.score,
      allMatches = matches,
    )
  }

  private fun classifyPipCount(card: Bitmap): Pair<Int, Double> {
    // SWGOH renders the 5/6 pip dots ABOVE the mod icon frame as a row of
    // small bright markers on the dark stats-panel background. The shape
    // frame top is at y=0.131; dots sit roughly y=0.05..0.115. Bright on
    // dark — threshold to binary, count blobs of plausible size.
    val w = card.width
    val h = card.height
    val left = (w * 0.405f).toInt().coerceIn(0, w - 1)
    val right = (w * 0.495f).toInt().coerceIn(left + 1, w)
    val top = (h * 0.045f).toInt().coerceIn(0, h - 1)
    val bottom = (h * 0.120f).toInt().coerceIn(top + 1, h)

    val strip = Bitmap.createBitmap(card, left, top, right - left, bottom - top)
    val rgba = Mat()
    Utils.bitmapToMat(strip, rgba)
    val gray = Mat()
    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
    val bin = Mat()
    Imgproc.threshold(gray, bin, PIP_BRIGHT_THRESHOLD, 255.0, Imgproc.THRESH_BINARY)

    val labels = Mat()
    val stats = Mat()
    val centroids = Mat()
    val numLabels = Imgproc.connectedComponentsWithStats(bin, labels, stats, centroids, 8, CvType.CV_32S)

    val area = (bin.rows() * bin.cols()).toDouble()
    val minDot = (area * 0.0008).coerceAtLeast(8.0)
    val maxDot = area * 0.05
    var dotCount = 0
    // Label 0 is background — skip.
    for (i in 1 until numLabels) {
      val a = stats.get(i, Imgproc.CC_STAT_AREA)[0]
      if (a in minDot..maxDot) dotCount += 1
    }

    rgba.release(); gray.release(); bin.release()
    labels.release(); stats.release(); centroids.release()
    strip.recycle()

    return when (dotCount) {
      5 -> 5 to 1.0
      6 -> 6 to 1.0
      4 -> 5 to 0.4
      7 -> 6 to 0.4
      else -> 0 to 0.0
    }
  }

  companion object {
    private const val TAG = "ModTierClassifier"

    // Inner sample box scale — fraction of the shape frame box to sample.
    // 0.85 stays well inside the shape outline to avoid the metallic bezel.
    private const val INTERIOR_SCALE = 0.85f

    // Saturation/brightness window for "tier-fill" pixels in the interior.
    // Drops the dark frame outline (V too low) and the bright set-symbol
    // overlay highlights (V too high). MIN_S=60 keeps the pale cyan E
    // pixels in scope; profiles split E vs C by their own S envelopes.
    private const val MIN_INTERIOR_S = 60
    private const val MIN_INTERIOR_V = 60
    private const val MAX_INTERIOR_V = 240

    // Minimum winner score to declare the result confident.
    private const val MIN_TIER_SCORE = 0.30

    // Top-1 vs runner-up margin required for confidence.
    private const val MIN_TIER_MARGIN = 0.10

    // Pip dot brightness threshold (V channel cutoff).
    private const val PIP_BRIGHT_THRESHOLD = 150.0
  }
}
