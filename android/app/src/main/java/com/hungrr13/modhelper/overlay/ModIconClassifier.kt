package com.hungrr13.modhelper.overlay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Bitmap.CompressFormat
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.util.Log
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfInt
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.sqrt

class ModIconClassifier(private val context: Context) {
  data class MatchScore(
    val name: String,
    val score: Double,
  )

  data class Detection(
    val shape: String?,
    val setName: String?,
    val shapeScore: Double,
    val setScore: Double,
    val topShapeMatches: List<MatchScore>,
    val topSetMatches: List<MatchScore>,
  )

  private data class ShapeCropVariant(
    val label: String,
    val bitmap: Bitmap,
    val widthRatio: Float,
    val heightRatio: Float,
  )

  private val size = 72
  private val setSymbolSize = 64
  private val referenceShapeReferences by lazy { loadBundledShapeReferences() }
  private val baseShapeTemplates by lazy { loadShapeTemplates() }
  private val setTemplates by lazy { loadSetTemplates(includeLearnedAssets = false) }
  @Volatile private var cachedLearnedShapePrototypes: Map<String, List<LearnedShapePrototype>>? = null
  @Volatile private var extendedSetTemplates: Map<String, SetTemplate>? = null
  @Volatile private var learnedSetModels: Map<String, LearnedProfileModel>? = null
  @Volatile private var rawTemplateStore: Map<String, Map<String, List<FloatArray>>>? = null
  private val rawTemplateDim = 48
  @Volatile private var extendedAssetsWarmUpStarted = false
  private var lastArrowBurstObservation: ArrowBurstObservation? = null
  private var lastShapeObservation: ShapeObservation? = null
  private var lastShapeDebugText: String? = null
  private var lastShapeRoundSeedMask: BooleanArray? = null
  private var lastShapeRoundSmoothedMask: BooleanArray? = null
  private var lastShapeCircleBoundaryMask: BooleanArray? = null
  private var lastShapeContourOverlayBitmap: Bitmap? = null
  private var lastSyntheticCandidateDebugs: List<SyntheticCandidateDebug> = emptyList()
  private var lastSyntheticWinnerLabel: String? = null

  fun warmUp() {
    // Keep first-scan blocking work minimal, then finish the expensive learned assets in the background.
    ensureOpenCvReady()
    if (USE_SYNTHETIC_OUTER_SHAPE_PIPELINE) {
      referenceShapeReferences
    }
    learnedShapeTemplates()
    setTemplates
    ensureExtendedAssetsWarmUp()
  }

  fun warmUpBlocking() {
    warmUp()
    // Synchronously load the learned-set templates and models so the first scan
    // doesn't pay their cost. ensureExtendedAssetsWarmUp starts a background thread
    // and returns immediately; wait for both outputs to be populated here.
    try {
      if (extendedSetTemplates == null) {
        extendedSetTemplates = loadSetTemplates(includeLearnedAssets = true)
      }
    } catch (_: Exception) {
    }
    try {
      if (learnedSetModels == null) {
        learnedSetModels = loadLearnedSetModels()
      }
    } catch (_: Exception) {
    }
    try {
      if (rawTemplateStore == null) {
        rawTemplateStore = loadRawImageTemplates()
      }
    } catch (_: Exception) {
    }
  }

  fun classify(
    cardBitmap: Bitmap,
    preferredSetProfile: String? = null,
    skipSetDetection: Boolean = false,
  ): Detection {
    val shapeBitmaps = cropShapeRegions(cardBitmap)
    val iconBitmaps = cropIconRegions(cardBitmap)
    var bestShapeDetection = ShapeDetectionResult(null, 0.0, emptyList())
    var bestSetDetection = SetDetectionResult(null, 0.0, emptyList())
    var bestShapeVariantLabel: String? = null
    lastSyntheticCandidateDebugs = emptyList()
    lastSyntheticWinnerLabel = null

    shapeBitmaps.forEach { shapeVariant ->
      val shapeResult = detectShape(shapeVariant.bitmap)
      val shapeScore = shapeResult.score + shapeCropVariantAdjustment(shapeResult, shapeVariant)
      if (shapeScore > bestShapeDetection.score) {
        if (bestShapeDetection.contourOverlayBitmap != null && bestShapeDetection.contourOverlayBitmap !== shapeResult.contourOverlayBitmap) {
          bestShapeDetection.contourOverlayBitmap?.recycle()
        }
        recycleSyntheticCandidateDebugs(bestShapeDetection.syntheticCandidateDebugs)
        bestShapeDetection = shapeResult.copy(score = shapeScore)
        lastShapeObservation = shapeResult.observation
        lastShapeContourOverlayBitmap = shapeResult.contourOverlayBitmap
        lastSyntheticCandidateDebugs = shapeResult.syntheticCandidateDebugs
        lastSyntheticWinnerLabel = shapeResult.syntheticWinnerLabel
        bestShapeVariantLabel = shapeVariant.label
      } else {
        shapeResult.contourOverlayBitmap?.recycle()
        recycleSyntheticCandidateDebugs(shapeResult.syntheticCandidateDebugs)
      }
      if (shapeVariant.bitmap != cardBitmap) {
        shapeVariant.bitmap.recycle()
      }
    }

    val bestObservedContourMetrics = bestShapeDetection.observation?.let { observation ->
      val smoothedRoundMask = cleanupRoundShapeMask(observation.mask, size)
      val smoothedRoundOutlineMask = extractOutlineMask(smoothedRoundMask, size)
      val smoothedRoundOuterContourProfile = buildContourRadiusProfile(smoothedRoundOutlineMask, size, useNearest = false)
      val smoothedRoundContourTurnProfile = buildContourTurnProfile(smoothedRoundOuterContourProfile)
      buildContourMetrics(
        observedMask = observation.mask,
        observedOutlineMask = observation.outlineMask,
        observedOuterContourProfile = observation.outerContourProfile,
        observedContourTurnProfile = observation.contourTurnProfile,
        smoothedRoundMask = smoothedRoundMask,
        smoothedRoundOutlineMask = smoothedRoundOutlineMask,
        smoothedRoundOuterContourProfile = smoothedRoundOuterContourProfile,
        smoothedRoundContourTurnProfile = smoothedRoundContourTurnProfile,
        dimension = size,
      )
    }

    bestShapeDetection = refineShapeSelection(bestShapeDetection, bestObservedContourMetrics)

    lastShapeDebugText = buildString {
      appendLine("shapeVariant=$bestShapeVariantLabel")
      appendLine("shapeSelected=${bestShapeDetection.name}")
      appendLine("shapeSelectedScore=${bestShapeDetection.score}")
      bestObservedContourMetrics?.let { metrics ->
        appendLine("shapeCircularity=${metrics.circularity}")
        appendLine("shapeEllipseFit=${metrics.ellipseFitQuality}")
        appendLine("shapeCornerCount=${metrics.cornerCount}")
        appendLine("shapeDiagonalDominance=${metrics.diagonalDominance}")
        appendLine("shapeOrthogonalDominance=${metrics.orthogonalDominance}")
        appendLine("shapeSmoothedCircularity=${metrics.smoothedCircularity}")
        appendLine("shapeSmoothedEllipseFit=${metrics.smoothedEllipseFitQuality}")
        appendLine("shapeSmoothedCornerCount=${metrics.smoothedCornerCount}")
        appendLine("shapeSmoothedOrthogonalDominance=${metrics.smoothedOrthogonalDominance}")
        val geometry = buildShapeGeometryMetrics(
          observedMask = lastShapeObservation?.mask ?: return@let,
          observedOutlineMask = lastShapeObservation?.outlineMask ?: return@let,
          observedPointCloud = lastShapeObservation?.pointCloud ?: emptyList(),
          contourMetrics = metrics,
          triangleBoundaryMetrics = buildTriangleBoundaryMetrics(lastShapeObservation?.mask ?: return@let, size),
          openCvContourResult = null,
          dimension = size,
        )
        appendLine("shapeVertices=${geometry.vertices}")
        appendLine("shapeAspectRatio=${geometry.aspectRatio}")
        appendLine("shapeExtent=${geometry.extent}")
        appendLine("shapeCenterBarStrength=${geometry.centerBarStrength}")
        appendLine("shapeAsymmetry=${geometry.asymmetry}")
        appendLine("shapeTriangleScore=${geometry.triangleScore}")
        appendLine("shapeDiamondCornerScore=${geometry.diamondCornerScore}")
        appendLine("shapeDiamondDiagonalScore=${geometry.diamondDiagonalScore}")
      }
      bestShapeDetection.topMatches.forEachIndexed { index, match ->
        appendLine("shapeTop${index + 1}=${match.name}:${match.score}")
      }
      if (lastSyntheticWinnerLabel != null) {
        appendLine("shapeSyntheticWinner=$lastSyntheticWinnerLabel")
      }
      lastSyntheticCandidateDebugs.forEach { candidate ->
        val slug = slugifyDebugName(candidate.label)
        appendLine("shapeCandidate-$slug-won=${candidate.won}")
        candidate.topMatches.take(4).forEachIndexed { index, match ->
          appendLine("shapeCandidate-$slug-top${index + 1}=${match.name}:${match.score}")
        }
        candidate.ruleDebug?.let { debug ->
          appendLine("shapeCandidate-$slug-vertices=${debug.geometry.vertices}")
          appendLine("shapeCandidate-$slug-aspect=${debug.geometry.aspectRatio}")
          appendLine("shapeCandidate-$slug-extent=${debug.geometry.extent}")
          appendLine("shapeCandidate-$slug-circularity=${debug.geometry.circularity}")
          appendLine("shapeCandidate-$slug-orthogonal=${debug.geometry.orthogonalDominance}")
          appendLine("shapeCandidate-$slug-centerBar=${debug.geometry.centerBarStrength}")
          appendLine("shapeCandidate-$slug-circleLooksBoxy=${debug.circleLooksBoxy}")
          appendLine("shapeCandidate-$slug-circleLooksNotched=${debug.circleLooksNotched}")
          appendLine("shapeCandidate-$slug-circleLooksDiamondish=${debug.circleLooksDiamondish}")
          appendLine("shapeCandidate-$slug-circleLooksSquareish=${debug.circleLooksSquareish}")
          appendLine("shapeCandidate-$slug-squareLooksExplicit=${debug.squareLooksExplicit}")
          appendLine("shapeCandidate-$slug-stronglyRound=${debug.stronglyRound}")
          appendLine("shapeCandidate-$slug-arrowLooksCompact=${debug.arrowLooksCompact}")
          appendLine("shapeCandidate-$slug-score-Circle=${debug.scores["Circle"] ?: 0.0}")
          appendLine("shapeCandidate-$slug-score-Square=${debug.scores["Square"] ?: 0.0}")
          appendLine("shapeCandidate-$slug-score-Diamond=${debug.scores["Diamond"] ?: 0.0}")
          appendLine("shapeCandidate-$slug-score-Triangle=${debug.scores["Triangle"] ?: 0.0}")
          appendLine("shapeCandidate-$slug-score-Arrow=${debug.scores["Arrow"] ?: 0.0}")
          appendLine("shapeCandidate-$slug-score-Cross=${debug.scores["Cross"] ?: 0.0}")
        }
      }
    }
    writeShapeObservedDebug(
      debugText = lastShapeDebugText,
      observedRawGray = lastShapeObservation?.rawGray,
      observedMask = lastShapeObservation?.mask,
      observedOutlineMask = lastShapeObservation?.outlineMask,
      observedRoundSeedMask = lastShapeRoundSeedMask,
      observedRoundSmoothedMask = lastShapeRoundSmoothedMask,
      observedCircleBoundaryMask = lastShapeCircleBoundaryMask,
      observedContourOverlayBitmap = lastShapeContourOverlayBitmap,
      syntheticCandidateDebugs = lastSyntheticCandidateDebugs,
    )
    dumpShapeDebug(lastShapeDebugText ?: "")

    val shapeDrivenProfiles = setProfilesForShape(bestShapeDetection.name)
    val setProfilesToEvaluate = (shapeDrivenProfiles + listOfNotNull(preferredSetProfile)).distinct()

    if (skipSetDetection) {
      iconBitmaps.forEach { iconBitmap ->
        if (iconBitmap != cardBitmap) iconBitmap.recycle()
      }
    } else {
      try {
        val outDir = context.getExternalFilesDir(null)
        if (outDir != null) {
          outDir.mkdirs()
          java.io.File(outDir, "set-debug-last.txt").writeText("")
        }
      } catch (_: Throwable) {
      }
      iconBitmaps.forEach { iconBitmap ->
        val setResult = detectSet(iconBitmap, setProfilesToEvaluate)
        // High-confidence override: only when peak is exceptional (>= 0.85).
        // Lower thresholds (e.g. 0.79) can fire on a misleading crop where the
        // model probability for the winner is moderate — in that range, a
        // higher-scored alternative crop with model ~1.0 is more trustworthy.
        val newHighConf = setResult.peakRawConfidence >= 0.85
        val curHighConf = bestSetDetection.peakRawConfidence >= 0.85
        val prefer = when {
          newHighConf && !curHighConf -> true
          !newHighConf && curHighConf -> false
          newHighConf && curHighConf -> setResult.peakRawConfidence > bestSetDetection.peakRawConfidence
          else -> {
            val scoreDelta = setResult.score - bestSetDetection.score
            scoreDelta > 0.02 ||
              (kotlin.math.abs(scoreDelta) <= 0.02 &&
                setResult.peakRawConfidence > bestSetDetection.peakRawConfidence)
          }
        }
        if (prefer) {
          bestSetDetection = setResult
        }
        if (iconBitmap != cardBitmap) {
          iconBitmap.recycle()
        }
      }
    }

    if (!skipSetDetection) {
      try {
        val outDir = context.getExternalFilesDir(null)
        if (outDir != null) {
          val setDebugFile = java.io.File(outDir, "set-debug-last.txt")
          setDebugFile.appendText("\n===FINAL=== name=${bestSetDetection.name} score=${bestSetDetection.score} peakRaw=${bestSetDetection.peakRawConfidence}\n")
        }
      } catch (_: Throwable) {
      }
    }

    return Detection(
      shape = bestShapeDetection.name,
      setName = bestSetDetection.name,
      shapeScore = bestShapeDetection.score,
      setScore = bestSetDetection.score,
      topShapeMatches = bestShapeDetection.topMatches,
      topSetMatches = bestSetDetection.topMatches,
    )
  }

  private fun cropIconRegions(cardBitmap: Bitmap): List<Bitmap> {
    val width = cardBitmap.width
    val height = cardBitmap.height
    val variants = listOf(
      floatArrayOf(0.395f, 0.105f, 0.16f, 0.22f),
      floatArrayOf(0.382f, 0.095f, 0.18f, 0.24f),
      floatArrayOf(0.405f, 0.11f, 0.15f, 0.21f),
    )

    return variants.map { variant ->
      val left = (width * variant[0]).toInt().coerceIn(0, width - 1)
      val top = (height * variant[1]).toInt().coerceIn(0, height - 1)
      val cropWidth = (width * variant[2]).toInt().coerceAtLeast(1).coerceAtMost(width - left)
      val cropHeight = (height * variant[3]).toInt().coerceAtLeast(1).coerceAtMost(height - top)
      Bitmap.createBitmap(cardBitmap, left, top, cropWidth, cropHeight)
    }
  }

  private fun cropShapeRegions(cardBitmap: Bitmap): List<ShapeCropVariant> {
    val width = cardBitmap.width
    val height = cardBitmap.height
    // Measured from HSV bbox detection across 3 captures (purple cross,
    // blue square, green circle): shape frame lives at
    //   left=0.410, top=0.131, width=0.075, height=0.191
    // (focused.png is 2059x820, frame is ~154x157 px at x=845, y=109).
    // Previous ratios (~0.32 / 0.26 / 0.36) were ~3x too wide and ~180 px
    // too far left, landing inside the character portrait + stats panel.
    val variants = listOf(
      floatArrayOf(0.410f, 0.130f, 0.075f, 0.191f),  // measured center
      floatArrayOf(0.405f, 0.125f, 0.080f, 0.200f),  // looser
      floatArrayOf(0.415f, 0.135f, 0.070f, 0.185f),  // tighter
      floatArrayOf(0.408f, 0.120f, 0.078f, 0.205f),  // taller
      floatArrayOf(0.412f, 0.140f, 0.073f, 0.180f),  // shorter
      floatArrayOf(0.400f, 0.130f, 0.085f, 0.195f),  // wider, left
      floatArrayOf(0.420f, 0.130f, 0.070f, 0.185f),  // narrower, right
      floatArrayOf(0.405f, 0.115f, 0.080f, 0.215f),  // top+tall
      floatArrayOf(0.415f, 0.145f, 0.070f, 0.175f),  // bottom+short
      floatArrayOf(0.410f, 0.125f, 0.078f, 0.200f),  // slight pad
    )

    return variants.mapIndexed { index, variant ->
      val left = (width * variant[0]).toInt().coerceIn(0, width - 1)
      val top = (height * variant[1]).toInt().coerceIn(0, height - 1)
      val cropWidth = (width * variant[2]).toInt().coerceAtLeast(1).coerceAtMost(width - left)
      val cropHeight = (height * variant[3]).toInt().coerceAtLeast(1).coerceAtMost(height - top)
      ShapeCropVariant(
        label = "shape-$index(${variant[0]},${variant[1]},${variant[2]},${variant[3]})",
        bitmap = Bitmap.createBitmap(cardBitmap, left, top, cropWidth, cropHeight),
        widthRatio = variant[2],
        heightRatio = variant[3],
      )
    }
  }

  private fun shapeCropVariantAdjustment(
    result: ShapeDetectionResult,
    variant: ShapeCropVariant,
  ): Double {
    return 0.0
  }

  private fun refineShapeSelection(
    detection: ShapeDetectionResult,
    contourMetrics: ContourMetrics?,
  ): ShapeDetectionResult {
    val observation = detection.observation ?: return detection
    val metrics = contourMetrics ?: return detection
    val geometry = buildShapeGeometryMetrics(
      observedMask = observation.mask,
      observedOutlineMask = observation.outlineMask,
      observedPointCloud = observation.pointCloud,
      contourMetrics = metrics,
      triangleBoundaryMetrics = buildTriangleBoundaryMetrics(observation.mask, size),
      openCvContourResult = null,
      dimension = size,
    )

    val maskOnlyGeometry = detection.syntheticCandidateDebugs
      .firstOrNull { it.label == "mask-only" }
      ?.ruleDebug
      ?.geometry
    // A real cross-shaped icon leaves the bounding-box corners empty, so its
    // mask-only (full-image threshold) extent is ~0.55-0.70. When mask-only
    // shows a near-fully-filled square aspect, the chosen Cross score is
    // tracing a hollow square frame, not a real plus sign.
    val maskOnlyLooksSquare =
      maskOnlyGeometry != null &&
        maskOnlyGeometry.extent >= 0.92 &&
        maskOnlyGeometry.aspectRatio in 0.92..1.10 &&
        maskOnlyGeometry.circularity <= 0.55
    // A real circle is symmetric; arrowLooksCompact requires asymmetry > 0.82.
    // When the chosen candidate traces a round outer boundary of an arrow (the
    // notch is lost on the outer trace), a guided candidate that does see the
    // notch will flag arrowLooksCompact with a strong Arrow score.
    val anyCandidateLooksArrow =
      detection.syntheticCandidateDebugs.any { candidate ->
        val debug = candidate.ruleDebug ?: return@any false
        debug.arrowLooksCompact && (debug.scores["Arrow"] ?: 0.0) >= 0.50
      }
    // When the winning candidate's own silhouette is very round
    // (circularity >= 0.84 and square-ish aspect), block the Circle -> Diamond
    // rescue rules below. The top-level geometry can still flag a high
    // diamondCornerScore on noisy masks even when the true mod silhouette
    // is round — the Grievous-Circle case, where a candidate literally says
    // Circle:0.97 but geometry.diamondCornerScore is 0.92 because of
    // artifacts from the character portrait.
    val winnerStronglyRound =
      detection.syntheticCandidateDebugs
        .firstOrNull { it.label == detection.syntheticWinnerLabel }
        ?.ruleDebug
        ?.stronglyRound == true
    // A rounded-looking diamond (e.g. lens/petal shape) traces a near-round
    // outer contour that scores Circle highly, but a guided candidate that
    // sees the four diamond corners flags circleLooksDiamondish.
    val anyCandidateLooksDiamond =
      detection.syntheticCandidateDebugs.any { candidate ->
        val debug = candidate.ruleDebug ?: return@any false
        debug.circleLooksDiamondish && (debug.scores["Diamond"] ?: 0.0) >= 0.35
      }
    // A circle with a central set icon fools outer/inner contour candidates
    // into tracing a rounded-square silhouette, but the mask-only candidate
    // (full-image threshold) still sees the true round outline. When mask-only
    // strongly picks Circle AND the shape is clearly round, trust it.
    // Calibrated against real-diamond samples (Diamond #2 mask-only scored
    // Circle=0.26, stronglyRound=false, circularity=0.658 — safely below).
    val maskOnlyDebug = detection.syntheticCandidateDebugs
      .firstOrNull { it.label == "mask-only" }?.ruleDebug
    val maskOnlyLooksStronglyCircle =
      maskOnlyDebug != null &&
        (maskOnlyDebug.scores["Circle"] ?: 0.0) >= 0.75 &&
        maskOnlyDebug.stronglyRound &&
        maskOnlyDebug.geometry.circularity >= 0.85
    // A Cross rescue to Square is only valid when no contour view actually
    // saw a clear Cross. Speed-set Crosses light up mask-only as square
    // (icon + halo fill the bbox) while inner/outer candidates still score
    // Cross strongly — we must not flip those to Square.
    val anyCandidateStronglyCross =
      detection.syntheticCandidateDebugs.any { candidate ->
        val debug = candidate.ruleDebug ?: return@any false
        (debug.scores["Cross"] ?: 0.0) >= 0.65
      }
    // A Cross with a central icon can fool the outer candidate into tracing
    // a near-square outline (extent ~0.75, circularity ~0.74) that scores
    // Square slightly over Cross. But the inner / unguided / mask-only
    // candidates each see the real cross arms and score Cross >= 0.60.
    // When >= 2 candidates strongly agree it's a Cross, rescue from Square.
    val strongCrossCandidateCount =
      detection.syntheticCandidateDebugs.count { candidate ->
        val debug = candidate.ruleDebug
        debug != null && (debug.scores["Cross"] ?: 0.0) >= 0.60
      }
    // squareLooksExplicit is a dedicated high-confidence Square flag set
    // only when a candidate sees 4 straight edges, strong centered fill,
    // and square-ish aspect. A real Square seen cleanly by inner/outer
    // will set this with Square score >= 0.75. When it fires, trust it
    // over any other misread (a Square whose outer candidate picked Cross
    // because the icon+fill confused the outline tracer).
    val anyCandidateLooksExplicitSquare =
      detection.syntheticCandidateDebugs.any { candidate ->
        val debug = candidate.ruleDebug ?: return@any false
        debug.squareLooksExplicit && (debug.scores["Square"] ?: 0.0) >= 0.75
      }
    // A Diamond with a central set icon can fool mask-only into tracing a
    // near-round silhouette (circularity 0.86, stronglyRound true) and win
    // Circle ~0.97. The observed top-level geometry still flags strong
    // diamondCornerScore (~0.92), but so does a real Grievous-portrait
    // Circle — so dCorner alone can't discriminate. The `outer` contour
    // candidate (which traces the rim edge directly) is the tiebreaker: a
    // true Circle's outer trace scores Circle high with circularity >= 0.70,
    // while a Diamond's outer trace sees the corners and scores Circle <=
    // 0.35 with circularity <= 0.55.
    val outerDebug = detection.syntheticCandidateDebugs
      .firstOrNull { it.label == "outer" }?.ruleDebug
    val outerContourLooksNonRound =
      outerDebug != null &&
        (outerDebug.scores["Circle"] ?: 0.0) <= 0.35 &&
        outerDebug.geometry.circularity <= 0.55

    try {
      Log.i("ModShapeDebug", "refineShapeSelection entry: name=${detection.name} smoothedCorners=${metrics.smoothedCornerCount} cornerCount=${metrics.cornerCount} dCorner=${geometry.diamondCornerScore} dDiag=${geometry.diamondDiagonalScore} triScore=${geometry.triangleScore}")
    } catch (_: Throwable) {}

    val forcedName =
      when {
        // HIGH-PRIORITY CIRCLE -> SQUARE RESCUE: a Square whose mask-only
        // silhouette has slightly rounded corners (e.g. portrait-erase
        // ellipses clipping the left edges, or natural anti-aliasing) can
        // score mask-only Circle if circularity ~ 0.84 and centerBar is low.
        // But a circle physically cannot fill more than pi/4 ~= 0.785 of its
        // bbox, and real Circle scans come in at extent 0.73-0.77. If
        // mask-only extent >= 0.80, the silhouette is physically NOT a
        // circle — it's a Square/rectangle with softened corners.
        detection.name == "Circle" &&
          maskOnlyDebug != null &&
          maskOnlyDebug.geometry.extent >= 0.80 ->
          "Square"
        // HIGH-PRIORITY EXPLICIT-SQUARE RESCUE: the squareLooksExplicit flag
        // is only set when a candidate sees 4 straight edges + centered fill
        // + square aspect. It's the strongest Square signal we produce and
        // outranks noisy Cross/Circle scores from other candidates. When any
        // candidate fires it with Square >= 0.75, trust Square regardless of
        // what top-level scoring picked.
        detection.name != "Square" &&
          anyCandidateLooksExplicitSquare ->
          "Square"
        // HIGH-PRIORITY SQUARE -> CROSS RESCUE: when the outer candidate
        // traces a boxy outline around a Cross's icon+halo and squeaks past
        // Cross in final scoring, but >= 2 other candidates score Cross
        // >= 0.60 from different vantage points, trust the majority.
        detection.name == "Square" &&
          strongCrossCandidateCount >= 2 ->
          "Cross"
        // HIGH-PRIORITY CIRCLE -> DIAMOND RESCUE: a rounded Diamond with a
        // set icon can smooth its mask-only silhouette into a ~0.97 Circle
        // win with stronglyRound=true, while the observed geometry still
        // exposes strong diamond-corner evidence. The `outer` contour tracer
        // is the tiebreaker — it looks at the rim directly and scores Circle
        // low with circularity ~0.38 when the true shape is a Diamond, but
        // scores Circle high with circularity ~0.75+ on a real Grievous-
        // portrait Circle. Fires before the stronglyRound-gated rescues
        // below so this case isn't blocked.
        detection.name == "Circle" &&
          geometry.diamondCornerScore >= 0.88 &&
          geometry.aspectRatio in 0.92..1.10 &&
          outerContourLooksNonRound ->
          "Diamond"
        // HIGH-PRIORITY CIRCLE RESCUE: a true Circle with a central set icon
        // can confuse outer/inner contour analysis into picking Square or
        // Diamond, but the mask-only candidate still sees the clean round
        // outline. Trust it when it's strongly round (empirically safe — a
        // classic rounded Diamond scores mask-only Circle ~0.26 with
        // circularity ~0.66, well below these thresholds). Guard: a
        // very-rounded Diamond (lens/petal silhouette) ALSO makes mask-only
        // look strongly circular — honour the Diamond signal over Circle.
        detection.name != "Circle" &&
          maskOnlyLooksStronglyCircle &&
          !anyCandidateLooksDiamond ->
          "Circle"
        // HIGH-PRIORITY TRIANGLE RESCUE: a gold Triangle with a central set
        // icon and halo can light up a vertical+horizontal bar through the
        // center, causing outer-candidate detection to pick Cross. But the
        // geometry still reveals triangle-like mass asymmetry. Calibrated so
        // real Diamonds (asymmetry <= 0.79) and Speed Crosses (asymmetry
        // <= 0.69) don't trigger.
        detection.name in listOf("Cross", "Square") &&
          geometry.triangleScore >= 0.55 &&
          geometry.asymmetry >= 0.90 &&
          geometry.aspectRatio in 0.90..1.15 ->
          "Triangle"
        detection.name == "Circle" &&
          geometry.extent >= 0.84 &&
          geometry.aspectRatio <= 1.08 &&
          geometry.centerBarStrength >= 0.68 &&
          geometry.orthogonalDominance >= 0.80 &&
          geometry.circularity >= 0.68 &&
          geometry.circularity <= 0.82 ->
          "Square"
        // Must come before the Cross->Square rule: a rounded Diamond whose
        // interior set symbol has strong center mass can score both Cross
        // (centered vertical+horizontal arms) and Square (via maskOnlyLooksSquare)
        // while still showing 4 strong diamond corners. Prefer Diamond when
        // diamondCornerScore is high and the outline is roughly square-aspect.
        // Extent guard: a real Diamond leaves the bbox corners empty
        // (extent ~0.65-0.70 in samples), while a Cross-with-set-icon fills
        // more of the bbox (extent ~0.78). Blocks Cross misrescue without
        // hurting rounded Diamonds.
        detection.name in listOf("Cross", "Square") &&
          geometry.diamondCornerScore >= 0.80 &&
          geometry.aspectRatio in 0.92..1.10 &&
          geometry.extent <= 0.73 ->
          "Diamond"
        // Cross -> Square rescue: only when no candidate actually saw a
        // strong Cross signal. A Speed-set Cross has its arms highlighted
        // in inner/outer candidate views even though mask-only looks square
        // because of the icon+halo filling the bbox.
        detection.name == "Cross" &&
          maskOnlyLooksSquare &&
          geometry.centerBarStrength <= 0.78 &&
          !anyCandidateStronglyCross ->
          "Square"
        detection.name == "Circle" &&
          !winnerStronglyRound &&
          anyCandidateLooksArrow ->
          "Arrow"
        detection.name == "Circle" &&
          !winnerStronglyRound &&
          anyCandidateLooksDiamond ->
          "Diamond"
        // Rounded Diamonds (e.g. lens/petal) can trace a near-circular outer
        // contour that scores Circle highly while still exposing 4 strong
        // diamond corners in the geometry. Rescue to Diamond BEFORE the
        // Circle->Triangle rule below, which also matches rounded shapes.
        detection.name == "Circle" &&
          !winnerStronglyRound &&
          geometry.diamondCornerScore >= 0.80 &&
          geometry.aspectRatio in 0.92..1.12 ->
          "Diamond"
        // A rounded diamond can score Cross highly because its centered mass
        // produces high centerBarStrength + orthogonal dominance. When a
        // guided candidate flags circleLooksDiamondish with a notable Diamond
        // score AND the geometry shows strong diamond corners, rescue it.
        detection.name == "Cross" &&
          anyCandidateLooksDiamond &&
          geometry.diamondCornerScore >= 0.80 ->
          "Diamond"
        // A Diamond's interior set symbol can be boxy enough that the fallback
        // candidate (which weighs interior mass) picks Cross, even though the
        // silhouette has 4 corners and strong diagonal edges. If the geometry
        // gives clear diamond-diagonal + diamond-corner evidence AND the outer
        // outline has ~4 corners, override Cross to Diamond.
        detection.name == "Cross" &&
          geometry.diamondDiagonalScore >= 0.70 &&
          geometry.diamondCornerScore >= 0.55 &&
          (metrics.smoothedCornerCount == 4 || metrics.cornerCount in 3..5) ->
          "Diamond"
        // Triangle has 3 corners; Diamond has 4. If Triangle won but the
        // outline has 4 corners AND strong diamond geometry, that's a
        // misread Diamond.
        detection.name == "Triangle" &&
          metrics.smoothedCornerCount == 4 &&
          geometry.diamondDiagonalScore >= 0.65 &&
          geometry.diamondCornerScore >= 0.55 ->
          "Diamond"
        // Rounded Diamonds can smooth down to 3 corners, defeating the
        // corner-count check above. If diamondCornerScore is very strong on
        // its own — a signature of 4 diamond corners even when the outline
        // smooths — override Triangle to Diamond.
        detection.name == "Triangle" &&
          metrics.smoothedCornerCount in 3..5 &&
          geometry.diamondCornerScore >= 0.80 ->
          "Diamond"
        detection.name in listOf("Circle", "Diamond") &&
          geometry.centerBarStrength >= 0.48 &&
          geometry.orthogonalDominance >= 0.68 &&
          geometry.circularity <= 0.35 ->
          "Cross"
        detection.name in listOf("Circle", "Diamond") &&
          (metrics.cornerCount <= 4 || metrics.smoothedCornerCount <= 4) &&
          geometry.triangleScore >= 0.60 &&
          geometry.aspectRatio >= 0.95 &&
          geometry.aspectRatio <= 1.30 ->
          "Triangle"
        detection.name == "Circle" &&
          !winnerStronglyRound &&
          geometry.vertices in 4..6 &&
          geometry.diamondDiagonalScore >= 0.72 &&
          geometry.centerBarStrength <= 0.45 &&
          geometry.circularity <= 0.55 ->
          "Diamond"
        else -> null
      }

    if (forcedName == null) return detection

    try {
      Log.i("ModShapeDebug", "forcedName fired: ${detection.name} -> $forcedName (smoothedCorners=${metrics.smoothedCornerCount}, dCorner=${geometry.diamondCornerScore}, dDiag=${geometry.diamondDiagonalScore})")
    } catch (_: Throwable) {}

    val forcedTop = detection.topMatches.toMutableList()
    val existingForced = forcedTop.firstOrNull { it.name == forcedName }?.score ?: (detection.score + 0.05)
    val bumpedScore = max(existingForced, detection.score + 0.05)
    forcedTop.removeAll { it.name == forcedName }
    forcedTop.add(0, MatchScore(forcedName, bumpedScore))
    val normalizedTop = forcedTop.sortedByDescending { it.score }.take(4)
    val normalizedScore = normalizedTop.firstOrNull()?.score ?: detection.score
    return detection.copy(
      name = forcedName,
      score = normalizedScore,
      topMatches = normalizedTop,
    )
  }

  private data class ShapeDetectionResult(
    val name: String?,
    val score: Double,
    val topMatches: List<MatchScore>,
    val observation: ShapeObservation? = null,
    val contourOverlayBitmap: Bitmap? = null,
    val syntheticCandidateDebugs: List<SyntheticCandidateDebug> = emptyList(),
    val syntheticWinnerLabel: String? = null,
  )

  private data class ShapeTemplate(
    val name: String,
    val mask: BooleanArray,
    val outlineMask: BooleanArray,
    val pointCloud: List<CloudPoint>,
    val outerContourProfile: DoubleArray,
    val innerContourProfile: DoubleArray,
    val contourTurnProfile: DoubleArray,
    val contourThicknessProfile: DoubleArray,
    val rowProfile: DoubleArray,
    val columnProfile: DoubleArray,
    val mainDiagonalProfile: DoubleArray,
    val antiDiagonalProfile: DoubleArray,
    val featureVector: DoubleArray,
    val rawGray: IntArray? = null,
  )

  private data class LearnedShapePrototype(
    val template: ShapeTemplate,
    val sampleCount: Int,
    val rawGraySampleCount: Int,
  )

  private data class ShapeObservation(
    val mask: BooleanArray,
    val outlineMask: BooleanArray,
    val pointCloud: List<CloudPoint>,
    val outerContourProfile: DoubleArray,
    val innerContourProfile: DoubleArray,
    val contourTurnProfile: DoubleArray,
    val contourThicknessProfile: DoubleArray,
    val rowProfile: DoubleArray,
    val columnProfile: DoubleArray,
    val mainDiagonalProfile: DoubleArray,
    val antiDiagonalProfile: DoubleArray,
    val featureVector: DoubleArray,
    val rawGray: IntArray? = null,
  )

  private data class ContourMetrics(
    val circularity: Double,
    val ellipseFitQuality: Double,
    val cornerCount: Int,
    val diagonalDominance: Double,
    val orthogonalDominance: Double,
    val smoothedCircularity: Double = circularity,
    val smoothedEllipseFitQuality: Double = ellipseFitQuality,
    val smoothedCornerCount: Int = cornerCount,
    val smoothedOrthogonalDominance: Double = orthogonalDominance,
  )

  private data class ShapeGeometryMetrics(
    val vertices: Int,
    val aspectRatio: Double,
    val extent: Double,
    val circularity: Double,
    val diagonalDominance: Double,
    val orthogonalDominance: Double,
    val centerBarStrength: Double,
    val asymmetry: Double,
    val triangleScore: Double,
    val apexNarrowness: Double,
    val tailSupport: Double,
    val diamondCornerScore: Double,
    val diamondDiagonalScore: Double,
  )

  private data class SimpleShapeRuleDebug(
    val scores: Map<String, Double>,
    val geometry: ShapeGeometryMetrics,
    val circleLooksBoxy: Boolean,
    val circleLooksNotched: Boolean,
    val circleLooksDiamondish: Boolean,
    val circleLooksSquareish: Boolean,
    val squareLooksExplicit: Boolean,
    val stronglyRound: Boolean,
    val arrowLooksCompact: Boolean,
  )

  private data class OpenCvContourResult(
    val mask: BooleanArray,
    val outlineMask: BooleanArray,
    val pointCloud: List<CloudPoint>,
    val vertices: Int,
    val aspectRatio: Double,
    val extent: Double,
    val circularity: Double,
  )

  private data class CloudPoint(
    val x: Double,
    val y: Double,
    val id: Int = 0,
  )

  private data class RoundBoundaryMetrics(
    val score: Double,
    val coverage: Double,
    val radiusStd: Double,
    val symmetry: Double,
    val crossVeto: Double,
  )

  private data class TriangleBoundaryMetrics(
    val score: Double,
    val apexNarrowness: Double,
    val baseWidth: Double,
    val tailSupport: Double,
    val centering: Double,
  )

  private data class SimpleShapeDescriptor(
    val vertices: Int,
    val aspectRatio: Double,
    val extent: Double,
    val circularity: Double,
    val mask: BooleanArray,
    val outlineMask: BooleanArray,
    val pointCloud: List<CloudPoint>,
    val area: Double,
    val perimeter: Double,
  )

  private data class SyntheticShapeReference(
    val name: String,
    val contour: MatOfPoint,
    val descriptor: SimpleShapeDescriptor,
  )

  private data class SyntheticShapeEvaluation(
    val label: String,
    val contour: MatOfPoint?,
    val descriptor: SimpleShapeDescriptor,
    val sortedMatches: List<MatchScore>,
    val ruleDebug: SimpleShapeRuleDebug,
  )

  private data class SyntheticCandidateDebug(
    val label: String,
    val mask: BooleanArray,
    val outlineMask: BooleanArray,
    val contourOverlayBitmap: Bitmap? = null,
    val topMatches: List<MatchScore> = emptyList(),
    val won: Boolean = false,
    val ruleDebug: SimpleShapeRuleDebug? = null,
  )

  private data class BundledShapeProfile(
    val name: String,
    val vertices: IntRange,
    val extentRange: ClosedFloatingPointRange<Double>,
    val circularityRange: ClosedFloatingPointRange<Double>,
    val aspectRange: ClosedFloatingPointRange<Double>,
  )

  private fun detectShape(iconBitmap: Bitmap): ShapeDetectionResult {
    if (USE_SYNTHETIC_OUTER_SHAPE_PIPELINE) {
      return detectShapeSyntheticContour(iconBitmap)
        ?: ShapeDetectionResult(
          name = null,
          score = 0.0,
          topMatches = emptyList(),
        )
    }
    if (USE_SIMPLE_OUTER_SHAPE_PIPELINE) {
      return detectShapeSimpleGeometry(iconBitmap)
        ?: ShapeDetectionResult(
          name = null,
          score = 0.0,
          topMatches = emptyList(),
        )
    }
    val hsvMask = buildObservedHsvShapeMask(iconBitmap)
    val openCvContourResult = extractOpenCvOuterContour(iconBitmap)
    val primaryShapeMask = openCvContourResult?.mask ?: hsvMask
    val edgeMask = closeMask(buildObservedEdgeMask(iconBitmap), size, radius = 1)
    val edgeConstrainedMask = intersectMasks(primaryShapeMask, dilateMask(edgeMask, size, radius = 1))
    val selectedShapeMask =
      if (maskDensity(edgeConstrainedMask) >= 0.12) edgeConstrainedMask else primaryShapeMask
    val normalizedShapeMask = normalizeShapeMask(
      selectedShapeMask,
      size,
    )
    val observedRawGray = buildObservedShapeGray(iconBitmap, size)
    val observedSilhouetteMask = normalizedShapeMask
    val observedOutlineMask = openCvContourResult?.outlineMask ?: extractOutlineMask(normalizedShapeMask, size)
    val observedPointCloud = openCvContourResult?.pointCloud ?: buildOuterShapePointCloud(observedSilhouetteMask, observedOutlineMask, size)
    val roundEdgeSeedMask = normalizeShapeMask(
      mergeMasks(
        buildObservedRoundEdgeMask(iconBitmap),
        observedOutlineMask,
      ),
      size,
    )
    val smoothedRoundMask = cleanupRoundShapeMask(roundEdgeSeedMask, size)
    val circleBoundaryMask = buildObservedCircleBoundaryMask(iconBitmap)
    val roundBoundaryMetrics = buildRoundBoundaryMetrics(circleBoundaryMask, size)
    val triangleBoundaryMetrics = buildTriangleBoundaryMetrics(observedSilhouetteMask, size)
    lastShapeRoundSeedMask = roundEdgeSeedMask.copyOf()
    lastShapeRoundSmoothedMask = smoothedRoundMask.copyOf()
    lastShapeCircleBoundaryMask = circleBoundaryMask.copyOf()
    val smoothedRoundOutlineMask = extractOutlineMask(smoothedRoundMask, size)
    val smoothedRoundOuterContourProfile = buildContourRadiusProfile(smoothedRoundOutlineMask, size, useNearest = false)
    val smoothedRoundContourTurnProfile = buildContourTurnProfile(smoothedRoundOuterContourProfile)
    val observedOuterContourProfile = buildContourRadiusProfile(observedOutlineMask, size, useNearest = false)
    val observedInnerContourProfile = buildContourRadiusProfile(observedOutlineMask, size, useNearest = true)
    val observedContourTurnProfile = buildContourTurnProfile(observedOuterContourProfile)
    val observedContourThicknessProfile = buildContourThicknessProfile(observedOuterContourProfile, observedInnerContourProfile)
    val observedContourMetrics = buildContourMetrics(
      observedMask = observedSilhouetteMask,
      observedOutlineMask = observedOutlineMask,
      observedOuterContourProfile = observedOuterContourProfile,
      observedContourTurnProfile = observedContourTurnProfile,
      smoothedRoundMask = smoothedRoundMask,
      smoothedRoundOutlineMask = smoothedRoundOutlineMask,
      smoothedRoundOuterContourProfile = smoothedRoundOuterContourProfile,
      smoothedRoundContourTurnProfile = smoothedRoundContourTurnProfile,
      dimension = size,
    )
    val observedGeometryMetrics = buildShapeGeometryMetrics(
      observedMask = observedSilhouetteMask,
      observedOutlineMask = observedOutlineMask,
      observedPointCloud = observedPointCloud,
      contourMetrics = observedContourMetrics,
      triangleBoundaryMetrics = triangleBoundaryMetrics,
      openCvContourResult = openCvContourResult,
      dimension = size,
    )
    val observedRowProfile = rowProfile(observedSilhouetteMask, size)
    val observedColumnProfile = columnProfile(observedSilhouetteMask, size)
    val observedMainDiagonalProfile = mainDiagonalProfile(observedSilhouetteMask, size)
    val observedAntiDiagonalProfile = antiDiagonalProfile(observedSilhouetteMask, size)
    val observedFeatureVector = buildShapeFeatureVector(
      observedSilhouetteMask,
      observedOutlineMask,
      size,
    )
    val scoredMatches = mutableListOf<MatchScore>()
    val baseTemplatesByShape = baseShapeTemplates.associateBy { it.name }

    SHAPE_ASSET_NAMES.keys.forEach { shapeName ->
      val baseTemplate = baseTemplatesByShape[shapeName]
      val baseScore = if (baseTemplate != null) {
        scoreShapeTemplate(
          observedMask = observedSilhouetteMask,
          observedOutlineMask = observedOutlineMask,
          observedPointCloud = observedPointCloud,
          observedOuterContourProfile = observedOuterContourProfile,
          observedInnerContourProfile = observedInnerContourProfile,
          observedContourTurnProfile = observedContourTurnProfile,
          observedContourThicknessProfile = observedContourThicknessProfile,
          observedContourMetrics = observedContourMetrics,
          observedRowProfile = observedRowProfile,
          observedColumnProfile = observedColumnProfile,
          observedMainDiagonalProfile = observedMainDiagonalProfile,
          observedAntiDiagonalProfile = observedAntiDiagonalProfile,
          observedFeatureVector = observedFeatureVector,
          observedRawGray = observedRawGray,
          roundBoundaryMetrics = roundBoundaryMetrics,
          triangleBoundaryMetrics = triangleBoundaryMetrics,
          template = baseTemplate,
          includeGeometryBonus = false,
        )
      } else {
        0.0
      }
      val geometryScore = scoreShapeGeometry(shapeName, observedGeometryMetrics)
      val combinedScore =
        if (geometryScore <= 0.0) {
          0.0
        } else if (geometryScore >= 0.72) {
          (geometryScore * 0.82) + (baseScore * 0.18)
        } else {
          (geometryScore * 0.68) + (baseScore * 0.32)
        }
      scoredMatches += MatchScore(shapeName, combinedScore)
    }

    val sortedMatches = scoredMatches.sortedByDescending { it.score }
    val bestMatch = sortedMatches.firstOrNull()
    val secondBestScore = sortedMatches.getOrNull(1)?.score ?: 0.0
    val bestScore = bestMatch?.score ?: 0.0
    val clearWinner = (bestScore - secondBestScore) >= 0.02
    val confidentWinner = bestScore >= 0.24
    val observation = ShapeObservation(
      mask = observedSilhouetteMask.copyOf(),
      outlineMask = observedOutlineMask.copyOf(),
      pointCloud = observedPointCloud.toList(),
      outerContourProfile = observedOuterContourProfile.copyOf(),
      innerContourProfile = observedInnerContourProfile.copyOf(),
      contourTurnProfile = observedContourTurnProfile.copyOf(),
      contourThicknessProfile = observedContourThicknessProfile.copyOf(),
      rowProfile = observedRowProfile.copyOf(),
      columnProfile = observedColumnProfile.copyOf(),
      mainDiagonalProfile = observedMainDiagonalProfile.copyOf(),
      antiDiagonalProfile = observedAntiDiagonalProfile.copyOf(),
      featureVector = observedFeatureVector.copyOf(),
      rawGray = observedRawGray.copyOf(),
    )
    lastShapeObservation = observation
    persistLatestShapeObservation(observation)
    return ShapeDetectionResult(
      name = if (bestScore >= 0.15 && (clearWinner || confidentWinner)) bestMatch?.name else null,
      score = bestScore,
      topMatches = sortedMatches.take(4),
      observation = observation,
    )
  }

  private fun detectShapeSimpleGeometry(iconBitmap: Bitmap): ShapeDetectionResult? {
    if (!ensureOpenCvReady()) return null

    var sourceMat: Mat? = null
    var hsvMat: Mat? = null
    var maskMat: Mat? = null
    var morphMat: Mat? = null
    var externalContourMat: Mat? = null
    var circleContourMat: Mat? = null
    var hierarchyMat: Mat? = null
    var kernelMat: Mat? = null
    try {
      sourceMat = Mat()
      Utils.bitmapToMat(iconBitmap, sourceMat)
      hsvMat = Mat()
      Imgproc.cvtColor(sourceMat, hsvMat, Imgproc.COLOR_RGB2HSV)
      maskMat = Mat()
      Core.inRange(
        hsvMat,
        Scalar(0.0, 20.0, 40.0),
        Scalar(180.0, 255.0, 255.0),
        maskMat,
      )
      kernelMat = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(5.0, 5.0))
      morphMat = Mat()
      Imgproc.morphologyEx(maskMat, morphMat, Imgproc.MORPH_CLOSE, kernelMat)
      hierarchyMat = Mat()
      externalContourMat = morphMat.clone()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        externalContourMat,
        contours,
        hierarchyMat,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      val bestContour = contours.maxByOrNull { contourSelectionScore(it, morphMat.width(), morphMat.height()) }
      val descriptor =
        bestContour?.let { buildSimpleShapeDescriptor(it, morphMat.width(), morphMat.height(), cleanupObservedArtifacts = true) }
          ?: buildSimpleShapeDescriptorFromMatMask(morphMat, cleanupObservedArtifacts = true)
          ?: return null
      val scores = scoreSimpleShapeRules(descriptor).toMutableMap()
      var selectedDescriptor = descriptor

      circleContourMat = morphMat.clone()
      val circleContours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        circleContourMat,
        circleContours,
        hierarchyMat,
        Imgproc.RETR_LIST,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      val genericCircleScore = scoreSimpleCircleRule(descriptor)
      val genericCrossScore = scores["Cross"] ?: 0.0
      val genericLooksLikeHousingBlob =
        descriptor.extent >= 0.95 &&
          descriptor.aspectRatio in 0.88..1.12 &&
          genericCrossScore >= 0.42
      val allowCircleVerifier =
        (
          descriptor.extent < 0.90 &&
            descriptor.circularity >= 0.55 &&
            genericCircleScore >= 0.40 &&
            genericCrossScore < 0.40
          ) || genericLooksLikeHousingBlob
      val circleContour = circleContours.maxByOrNull { circleContourSelectionScore(it, morphMat.width(), morphMat.height()) }
      var verifiedCircleDescriptor: SimpleShapeDescriptor? = null
      var contourCircleScore = 0.0
      if (circleContour != null) {
        val circleDescriptor = buildSimpleShapeDescriptor(circleContour, morphMat.width(), morphMat.height(), cleanupObservedArtifacts = true)
        if (circleDescriptor != null && allowCircleVerifier) {
          val circleScore = scoreSimpleCircleRule(circleDescriptor)
          contourCircleScore = circleScore
          val verifiedCircleScore =
            (
              ((scores["Circle"] ?: 0.0) * 0.65) +
                (circleScore * 0.35)
            ).coerceIn(0.0, 1.0)
          if (verifiedCircleScore > (scores["Circle"] ?: 0.0)) {
            scores["Circle"] = verifiedCircleScore
          }
          if (
            circleDescriptor.circularity >= 0.66 &&
              circleDescriptor.extent in 0.58..0.90 &&
              circleDescriptor.aspectRatio in 0.84..1.16
          ) {
            verifiedCircleDescriptor = circleDescriptor
          }
        }
      }

      val houghCircleDescriptor = buildSimpleCircleDescriptorFromHough(sourceMat)
      var houghCircleScore = 0.0
      if (houghCircleDescriptor != null && allowCircleVerifier) {
        houghCircleScore = (scoreSimpleCircleRule(houghCircleDescriptor) + 0.10).coerceIn(0.0, 1.0)
        val verifiedCircleScore =
          (
            ((scores["Circle"] ?: 0.0) * 0.60) +
              (houghCircleScore * 0.40)
          ).coerceIn(0.0, 1.0)
        if (verifiedCircleScore > (scores["Circle"] ?: 0.0)) {
          scores["Circle"] = verifiedCircleScore
        }
      }
      val strongCircleConsensus =
        allowCircleVerifier &&
          genericLooksLikeHousingBlob &&
          verifiedCircleDescriptor != null &&
          contourCircleScore >= 0.72 &&
          houghCircleScore >= 0.74
      if (strongCircleConsensus) {
        val consensusCircleScore =
          max(
            scores["Circle"] ?: 0.0,
            ((contourCircleScore * 0.55) + (houghCircleScore * 0.45) + 0.08).coerceIn(0.0, 1.0),
          )
        scores["Circle"] = consensusCircleScore
        scores["Cross"] = minOf(scores["Cross"] ?: 0.0, consensusCircleScore - 0.06).coerceAtLeast(0.0)
        scores["Square"] = minOf(scores["Square"] ?: 0.0, consensusCircleScore - 0.08).coerceAtLeast(0.0)
        selectedDescriptor = verifiedCircleDescriptor ?: selectedDescriptor
      }
      val sortedMatches = scores.entries
        .map { MatchScore(it.key, it.value) }
        .sortedByDescending { it.score }
      val bestMatch = sortedMatches.firstOrNull() ?: return null
      val secondBestScore = sortedMatches.getOrNull(1)?.score ?: 0.0
      val bestScore = bestMatch.score
      val clearWinner = (bestScore - secondBestScore) >= 0.05
      val confidentWinner = bestScore >= 0.45
      val observation = buildShapeObservation(
        selectedDescriptor.mask,
        selectedDescriptor.outlineMask,
        selectedDescriptor.pointCloud,
        buildObservedShapeGray(iconBitmap, size),
      )
      return ShapeDetectionResult(
        name = if (clearWinner || confidentWinner) bestMatch.name else null,
        score = bestScore,
        topMatches = sortedMatches.take(4),
        observation = observation,
      )
    } catch (_: Throwable) {
      return null
    } finally {
      sourceMat?.release()
      hsvMat?.release()
      maskMat?.release()
      morphMat?.release()
      externalContourMat?.release()
      circleContourMat?.release()
      hierarchyMat?.release()
      kernelMat?.release()
    }
  }

  private fun detectShapeSyntheticContour(iconBitmap: Bitmap): ShapeDetectionResult? {
    if (!ensureOpenCvReady()) return null

    var sourceMat: Mat? = null
    var grayMat: Mat? = null
    var blurMat: Mat? = null
    var edgeMat: Mat? = null
    var edgeMorphMat: Mat? = null
    var binaryMat: Mat? = null
    var morphMat: Mat? = null
    var contourMat: Mat? = null
    var hierarchyMat: Mat? = null
    var kernelMat: Mat? = null
    try {
      sourceMat = Mat()
      Utils.bitmapToMat(iconBitmap, sourceMat)
      grayMat = Mat()
      when (sourceMat.channels()) {
        4 -> Imgproc.cvtColor(sourceMat, grayMat, Imgproc.COLOR_RGBA2GRAY)
        3 -> Imgproc.cvtColor(sourceMat, grayMat, Imgproc.COLOR_RGB2GRAY)
        else -> sourceMat.copyTo(grayMat)
      }

      blurMat = Mat()
      Imgproc.GaussianBlur(grayMat, blurMat, Size(5.0, 5.0), 0.0)
      edgeMat = Mat()
      Imgproc.Canny(blurMat, edgeMat, 45.0, 135.0)
      kernelMat = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(3.0, 3.0))
      edgeMorphMat = Mat()
      Imgproc.morphologyEx(edgeMat, edgeMorphMat, Imgproc.MORPH_CLOSE, kernelMat)

      hierarchyMat = Mat()
      contourMat = edgeMorphMat.clone()
      val edgeContours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        contourMat,
        edgeContours,
        hierarchyMat,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )

      val outerContour =
        edgeContours.maxByOrNull { contourSelectionScore(it, edgeMorphMat.width(), edgeMorphMat.height()) }

      binaryMat = Mat()
      Imgproc.threshold(grayMat, binaryMat, 70.0, 255.0, Imgproc.THRESH_BINARY_INV)
      // Erase portrait-bubble zones from the binary silhouette mask before
      // contour finding. The player portrait (e.g. Grievous on a Circle mod)
      // is dark enough to survive THRESH_BINARY_INV and fuses with the
      // shape rim, turning Circles/Diamonds into square-ish blobs. Real mod
      // shapes never reach these corners, so blanking both lower-left and
      // upper-left is safe.
      run {
        val widthD = binaryMat.width().toDouble()
        val heightD = binaryMat.height().toDouble()
        val radii = Size(widthD * 0.30, heightD * 0.34)
        Imgproc.ellipse(binaryMat, Point(widthD * 0.18, heightD * 0.82), radii, 0.0, 0.0, 360.0, Scalar(0.0), -1)
        Imgproc.ellipse(binaryMat, Point(widthD * 0.18, heightD * 0.18), radii, 0.0, 0.0, 360.0, Scalar(0.0), -1)
      }
      morphMat = Mat()
      Imgproc.morphologyEx(binaryMat, morphMat, Imgproc.MORPH_CLOSE, kernelMat)

      var fallbackContour: MatOfPoint? = null
      if (outerContour == null) {
        hierarchyMat.release()
        hierarchyMat = Mat()
        contourMat.release()
        contourMat = morphMat.clone()
        val fillContours = mutableListOf<MatOfPoint>()
        Imgproc.findContours(
          contourMat,
          fillContours,
          hierarchyMat,
          Imgproc.RETR_EXTERNAL,
          Imgproc.CHAIN_APPROX_SIMPLE,
        )
        fallbackContour =
          fillContours.maxByOrNull { contourSelectionScore(it, morphMat.width(), morphMat.height()) }
      }

      val innerContour = buildInnerFrameContour(sourceMat, grayMat)
      val innerEvaluation =
        innerContour?.let { contour ->
          buildObservedSilhouetteEvaluation("inner", sourceMat, contour, morphMat.width(), morphMat.height())
        }
      val outerEvaluation =
        outerContour?.let { contour ->
          buildObservedSilhouetteEvaluation("outer", sourceMat, contour, morphMat.width(), morphMat.height())
        }
      val fallbackEvaluation =
        fallbackContour?.let { contour ->
          buildObservedSilhouetteEvaluation("fallback", sourceMat, contour, morphMat.width(), morphMat.height())
        }
      val unguidedEvaluation = buildObservedSilhouetteEvaluation("unguided", sourceMat, null, morphMat.width(), morphMat.height())
      val fallbackDescriptor = buildSimpleShapeDescriptorFromMatMask(morphMat, cleanupObservedArtifacts = true)
      val maskOnlyEvaluation = evaluateSyntheticShape("mask-only", null, fallbackDescriptor)
      val candidateEvaluations =
        listOfNotNull(innerEvaluation, outerEvaluation, fallbackEvaluation, unguidedEvaluation, maskOnlyEvaluation)
      // Candidate-selection priority:
      //  * Guided candidates (inner/outer/fallback/unguided) that return a
      //    usable score get first pick.
      //  * mask-only is a plain threshold fallback; it can produce wildly
      //    confident scores on disconnected noise masks (e.g. 0.74 Square on
      //    a C-shape). Only fall back to mask-only when no guided candidate
      //    cleared a minimum confidence bar.
      val guidedMinScore = 0.30
      val contourMinScore = 0.20
      val guidedEvaluations = candidateEvaluations.filter { it.label != "mask-only" }
      // Shape should be determined by the mod's rim outline, not by its
      // inner icon. The contour-driven candidates (`outer`, `fallback`)
      // trace the rim edge directly, so they are immune to inner-icon
      // variations (speed vs CD vs health primaries etc.). The cavity
      // candidates (`inner`, `unguided`) threshold dark pixels and can be
      // polluted by dark icon elements the hole-filler can't fully close
      // (e.g. a CD primary's crossed swords blob into a circle-like mask).
      // Always prefer contour-driven candidates; fall back to cavity only
      // when neither clears a minimum confidence.
      val contourDriven = guidedEvaluations.filter { it.label == "outer" || it.label == "fallback" }
      val bestContour = contourDriven.maxByOrNull { it.sortedMatches.firstOrNull()?.score ?: 0.0 }
      val bestContourScore = bestContour?.sortedMatches?.firstOrNull()?.score ?: 0.0
      val bestGuided =
        if (bestContour != null && bestContourScore >= contourMinScore) {
          bestContour
        } else {
          guidedEvaluations.maxByOrNull { it.sortedMatches.firstOrNull()?.score ?: 0.0 }
        }
      val bestGuidedScore = bestGuided?.sortedMatches?.firstOrNull()?.score ?: 0.0
      val contourPicked = bestGuided === bestContour && bestContour != null
      // If the mask-only candidate is overwhelmingly confident (top1 >= 0.85)
      // and beats the best guided candidate by a wide margin (>= 0.20), trust
      // it. Character portraits (e.g. Grievous on a Circle) add fake edges
      // that can fool the contour-driven candidates while leaving the
      // portrait-erased binary mask crisp enough for mask-only to nail the
      // shape. Guard bar is intentionally high so we don't regress on the
      // disconnected-noise-mask cases the general rule protects against.
      val maskOnlyEval = candidateEvaluations.firstOrNull { it.label == "mask-only" }
      val maskOnlyScore = maskOnlyEval?.sortedMatches?.firstOrNull()?.score ?: 0.0
      val maskOnlyOverride =
        maskOnlyEval != null && maskOnlyScore >= 0.85 && maskOnlyScore - bestGuidedScore >= 0.20
      val observedEvaluation =
        if (maskOnlyOverride) {
          maskOnlyEval!!
        } else if (
          (contourPicked && bestGuidedScore >= contourMinScore) ||
            (bestGuided != null && bestGuidedScore >= guidedMinScore)
        ) {
          bestGuided!!
        } else {
          candidateEvaluations
            .maxByOrNull { evaluation -> evaluation.sortedMatches.firstOrNull()?.score ?: 0.0 }
            ?: return null
        }
      val observedDescriptor = observedEvaluation.descriptor
      val contourOverlayBitmap = drawContourOverlayBitmap(iconBitmap, observedEvaluation.contour)
      val candidateDebugs =
        candidateEvaluations.map { evaluation ->
          SyntheticCandidateDebug(
            label = evaluation.label,
            mask = evaluation.descriptor.mask.copyOf(),
            outlineMask = evaluation.descriptor.outlineMask.copyOf(),
            contourOverlayBitmap = drawContourOverlayBitmap(iconBitmap, evaluation.contour),
            topMatches = evaluation.sortedMatches.take(4),
            won = evaluation.label == observedEvaluation.label,
            ruleDebug = evaluation.ruleDebug,
          )
        }
      val sortedMatches = observedEvaluation.sortedMatches
      val bestMatch = sortedMatches.firstOrNull() ?: return null
      val secondBestScore = sortedMatches.getOrNull(1)?.score ?: 0.0
      val bestScore = bestMatch.score
      val clearWinner = (bestScore - secondBestScore) >= 0.035
      val confidentWinner = bestScore >= 0.28
      val observation = buildShapeObservation(
        observedDescriptor.mask,
        observedDescriptor.outlineMask,
        observedDescriptor.pointCloud,
        buildObservedShapeGray(iconBitmap, size),
      )
      return ShapeDetectionResult(
        name = if (bestScore >= 0.18 && (clearWinner || confidentWinner)) bestMatch.name else null,
        score = bestScore,
        topMatches = sortedMatches.take(4),
        observation = observation,
        contourOverlayBitmap = contourOverlayBitmap,
        syntheticCandidateDebugs = candidateDebugs,
        syntheticWinnerLabel = observedEvaluation.label,
      )
    } catch (_: Throwable) {
      return null
    } finally {
      sourceMat?.release()
      grayMat?.release()
      blurMat?.release()
      edgeMat?.release()
      edgeMorphMat?.release()
      binaryMat?.release()
      morphMat?.release()
      contourMat?.release()
      hierarchyMat?.release()
      kernelMat?.release()
    }
  }

  private fun evaluateSyntheticShape(
    label: String,
    contour: MatOfPoint?,
    descriptor: SimpleShapeDescriptor?,
  ): SyntheticShapeEvaluation? {
    descriptor ?: return null
    val ruleDebug = buildSimpleShapeRuleDebug(descriptor)
    val geometryScores = ruleDebug.scores
    val rejectCornerFragment = isCornerFragmentCandidate(label, descriptor, ruleDebug.geometry)
    val contourScores =
      if (contour != null) {
        referenceShapeReferences.associate { reference ->
          val distance = Imgproc.matchShapes(contour, reference.contour, Imgproc.CONTOURS_MATCH_I1, 0.0)
          reference.name to contourDistanceToScore(distance)
        }
      } else {
        referenceShapeReferences.associate { reference ->
          val similarity = comparePointClouds(descriptor.pointCloud, reference.descriptor.pointCloud)
          reference.name to similarity.coerceIn(0.0, 1.0)
        }
      }

    val blendedScores =
      SYNTHETIC_SHAPE_ORDER.associateWith { shapeName ->
        val contourScore = contourScores[shapeName] ?: 0.0
        val geometryScore = geometryScores[shapeName] ?: 0.0
        val contourDrivenCandidate = contour != null && label in listOf("outer", "fallback")
        if (rejectCornerFragment || geometryScore <= 0.0) {
          0.0
        } else if (contourDrivenCandidate) {
          ((geometryScore * 0.42) + (contourScore * 0.58)).coerceIn(0.0, 1.0)
        } else if (geometryScore >= 0.72) {
          ((geometryScore * 0.82) + (contourScore * 0.18)).coerceIn(0.0, 1.0)
        } else {
          ((geometryScore * 0.68) + (contourScore * 0.32)).coerceIn(0.0, 1.0)
        }
      }

    val sortedMatches =
      blendedScores.entries
        .map { MatchScore(it.key, it.value) }
        .sortedByDescending { it.score }
    if (sortedMatches.isEmpty()) return null
    return SyntheticShapeEvaluation(
      label = label,
      contour = contour,
      descriptor = descriptor,
      sortedMatches = sortedMatches,
      ruleDebug = if (rejectCornerFragment) ruleDebug.copy(scores = ruleDebug.scores.mapValues { 0.0 }) else ruleDebug,
    )
  }

  private fun isCornerFragmentCandidate(
    label: String,
    descriptor: SimpleShapeDescriptor,
    geometry: ShapeGeometryMetrics,
  ): Boolean {
    if (label !in listOf("inner", "unguided")) return false
    val centroid = maskCentroid(descriptor.mask, size) ?: return false
    val centerX = centroid.first
    val centerY = centroid.second
    return centerX < 0.44 &&
      centerY < 0.44 &&
      geometry.extent in 0.40..0.72 &&
      geometry.circularity <= 0.32 &&
      geometry.orthogonalDominance >= 0.74
  }

  private fun maskCentroid(mask: BooleanArray, dimension: Int): Pair<Double, Double>? {
    var sumX = 0.0
    var sumY = 0.0
    var count = 0
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        if (!mask[y * dimension + x]) continue
        sumX += x.toDouble()
        sumY += y.toDouble()
        count++
      }
    }
    if (count == 0) return null
    val denom = max(1, dimension - 1).toDouble()
    return (sumX / count.toDouble()) / denom to (sumY / count.toDouble()) / denom
  }

  private fun buildObservedSilhouetteEvaluation(
    label: String,
    sourceMat: Mat,
    guidingContour: MatOfPoint?,
    width: Int,
    height: Int,
  ): SyntheticShapeEvaluation? {
    val (silhouetteContour, descriptor) =
      buildObservedSilhouetteDescriptor(label, sourceMat, guidingContour, width, height) ?: return null
    return evaluateSyntheticShape(label, silhouetteContour, descriptor)
  }

  private fun buildObservedSilhouetteDescriptor(
    label: String,
    sourceMat: Mat,
    guidingContour: MatOfPoint?,
    width: Int,
    height: Int,
  ): Pair<MatOfPoint?, SimpleShapeDescriptor>? {
    val observedMask = buildObservedSilhouetteMask(label, sourceMat, guidingContour, width, height) ?: return null
    val contourDrivenCandidate = label in listOf("outer", "fallback")
    val innerCandidate = label == "inner"
    val descriptor =
      buildSimpleShapeDescriptorFromRawBooleanMask(
        observedMask,
        width,
        height,
        targetFillRatio =
          when {
            contourDrivenCandidate -> 0.80
            innerCandidate -> 0.82
            else -> 0.88
          },
        isolateComponents = !contourDrivenCandidate,
        shiftRightRatio =
          when {
            contourDrivenCandidate -> 0.05
            innerCandidate -> 0.03
            else -> 0.0
          },
        shiftDownRatio = if (contourDrivenCandidate) 0.06 else 0.0,
      ) ?: return null
    val silhouetteContour = buildContourFromRawMask(observedMask, width, height) ?: guidingContour
    return Pair(silhouetteContour, descriptor)
  }

  private fun buildInnerFrameContour(sourceMat: Mat, grayMat: Mat): MatOfPoint? {
    var darkMat: Mat? = null
    var colorZoneMat: Mat? = null
    var colorMorphMat: Mat? = null
    var colorContourMat: Mat? = null
    var colorHierarchyMat: Mat? = null
    var colorKernelMat: Mat? = null
    var morphMat: Mat? = null
    var contourMat: Mat? = null
    var hierarchyMat: Mat? = null
    var kernelMat: Mat? = null
    return try {
      darkMat = Mat()
      Imgproc.threshold(grayMat, darkMat, 130.0, 255.0, Imgproc.THRESH_BINARY_INV)
      // For the inner candidate we want the SATURATED accent interior
      // (yellow/red/blue triangle fill) — NOT the silver outer frame chevrons.
      // The general color-zone mask ORs bright-neutral + vivid-accent and then
      // dilates with an 11x11 kernel, which merges the interior and the silver
      // frame into one blob and makes the inner trace bleed out of the
      // triangle. Use an accent-only mask here with a smaller kernel so we
      // trace just the colored cavity.
      colorZoneMat = buildInnerAccentColorZoneMask(sourceMat)
      val colorContour =
        colorZoneMat?.let { colorMask ->
          colorMorphMat = colorMask.clone()
          colorKernelMat = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(5.0, 5.0))
          Imgproc.morphologyEx(colorMorphMat, colorMorphMat, Imgproc.MORPH_CLOSE, colorKernelMat)
          // No dilate: we do not want to reach across the silver frame gap
          // between the inner triangle fill and the outer badge edges.
          applyInnerBottomBarTrim(colorMorphMat)
          colorContourMat = colorMorphMat.clone()
          colorHierarchyMat = Mat()
          val colorContours = mutableListOf<MatOfPoint>()
          Imgproc.findContours(
            colorContourMat,
            colorContours,
            colorHierarchyMat,
            Imgproc.RETR_EXTERNAL,
            Imgproc.CHAIN_APPROX_SIMPLE,
          )
          colorContours
            .maxByOrNull { innerContourSelectionScore(it, grayMat.width(), grayMat.height()) }
            ?.let { refineInnerFrameContour(it, grayMat.width(), grayMat.height()) ?: it }
        }
      if (colorContour != null) {
        return colorContour
      }
      if (colorZoneMat != null) {
        Core.bitwise_and(darkMat, colorZoneMat, darkMat)
      }
      val width = grayMat.width().toDouble()
      val height = grayMat.height().toDouble()
      applyShapeSearchZoneMask(darkMat, Scalar(0.0))
      applyInnerBottomBarTrim(darkMat)
      // Remove the portrait overlap (only when one is actually present) and
      // the right-side tab before tracing the inner cavity.
      if (hasPlayerPortraitBubble(sourceMat)) {
        Imgproc.ellipse(
          darkMat,
          Point(width * 0.18, height * 0.82),
          Size(width * 0.26, height * 0.30),
          0.0,
          0.0,
          360.0,
          Scalar(0.0),
          -1,
        )
      }
      Imgproc.rectangle(
        darkMat,
        Point(width * 0.90, height * 0.20),
        Point(width, height * 0.80),
        Scalar(0.0),
        -1,
      )
      Imgproc.rectangle(
        darkMat,
        Point(0.0, 0.0),
        Point(width * 0.12, height * 0.18),
        Scalar(0.0),
        -1,
      )
      val centerRadius = (minOf(grayMat.width(), grayMat.height()) * 0.15).coerceAtLeast(5.0)
      Imgproc.circle(
        darkMat,
        Point(width / 2.0, height / 2.0),
        centerRadius.toInt(),
        Scalar(255.0),
        -1,
      )
      kernelMat = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(7.0, 7.0))
      morphMat = Mat()
      Imgproc.morphologyEx(darkMat, morphMat, Imgproc.MORPH_CLOSE, kernelMat)
      Imgproc.morphologyEx(morphMat, morphMat, Imgproc.MORPH_OPEN, kernelMat)
      contourMat = morphMat.clone()
      hierarchyMat = Mat()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        contourMat,
        contours,
        hierarchyMat,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      contours
        .maxByOrNull { innerContourSelectionScore(it, grayMat.width(), grayMat.height()) }
        ?.let { refineInnerFrameContour(it, grayMat.width(), grayMat.height()) ?: it }
    } catch (_: Throwable) {
      null
    } finally {
      darkMat?.release()
      colorZoneMat?.release()
      colorMorphMat?.release()
      colorContourMat?.release()
      colorHierarchyMat?.release()
      colorKernelMat?.release()
      morphMat?.release()
      contourMat?.release()
      hierarchyMat?.release()
      kernelMat?.release()
    }
  }

  private fun applyInnerBottomBarTrim(mat: Mat) {
    val width = mat.width().toDouble()
    val height = mat.height().toDouble()
    if (width <= 0.0 || height <= 0.0) return
    Imgproc.rectangle(
      mat,
      Point(width * 0.30, height * 0.84),
      Point(width, height),
      Scalar(0.0),
      -1,
    )
  }

  /**
   * Accent-only color mask for the INNER candidate. Keeps only saturated
   * colored pixels (the yellow/red/blue triangle interior fill) and rejects
   * bright neutrals (silver frame chevrons, white highlights). Unlike
   * buildBadgeColorZoneMask this does not dilate, so the inner blob stays
   * separated from the outer silver frame across the gap between them.
   */
  private fun buildInnerAccentColorZoneMask(sourceMat: Mat): Mat? {
    var rgbMat: Mat? = null
    var hsvMat: Mat? = null
    var accentMask: Mat? = null
    var kernel: Mat? = null
    return try {
      rgbMat = Mat()
      when (sourceMat.channels()) {
        4 -> Imgproc.cvtColor(sourceMat, rgbMat, Imgproc.COLOR_RGBA2RGB)
        3 -> sourceMat.copyTo(rgbMat)
        else -> return null
      }
      hsvMat = Mat()
      Imgproc.cvtColor(rgbMat, hsvMat, Imgproc.COLOR_RGB2HSV)
      accentMask = Mat()
      // Tighter than buildBadgeColorZoneMask: require higher saturation so we
      // skip silver/white pixels entirely. The triangle fill is vivid yellow
      // / green / red / blue — all with sat > ~100 in practice.
      Core.inRange(hsvMat, Scalar(0.0, 90.0, 70.0), Scalar(180.0, 255.0, 255.0), accentMask)
      applyShapeSearchZoneMask(accentMask, Scalar(0.0))
      val width = accentMask.width().toDouble()
      val height = accentMask.height().toDouble()
      if (hasPlayerPortraitBubble(sourceMat)) {
        Imgproc.ellipse(
          accentMask,
          Point(width * 0.18, height * 0.82),
          Size(width * 0.26, height * 0.30),
          0.0, 0.0, 360.0,
          Scalar(0.0),
          -1,
        )
      }
      Imgproc.rectangle(
        accentMask,
        Point(width * 0.90, height * 0.20),
        Point(width, height * 0.80),
        Scalar(0.0),
        -1,
      )
      kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(3.0, 3.0))
      Imgproc.morphologyEx(accentMask, accentMask, Imgproc.MORPH_OPEN, kernel)
      accentMask.clone()
    } catch (_: Throwable) {
      null
    } finally {
      rgbMat?.release()
      hsvMat?.release()
      accentMask?.release()
      kernel?.release()
    }
  }

  /**
   * Mods may or may not have a player-portrait bubble at the bottom-left.
   * The shape pipeline has several defensive cuts that remove that region
   * unconditionally — which chops the triangle's bottom-left vertex when
   * no portrait is actually present. This helper inspects the source image
   * and reports whether a portrait bubble is actually visible at the
   * expected position, so each cut site can be gated accordingly.
   *
   * Heuristic: character portraits contain varied character art (skin, hair,
   * armor, backdrop) → high hue AND saturation variance. An empty corner of
   * a mod icon shows only a silvery rim (low saturation) plus a single
   * set-color band (narrow hue) → low hue/sat variance.
   */
  private fun hasPlayerPortraitBubble(sourceMat: Mat): Boolean {
    val width = sourceMat.width()
    val height = sourceMat.height()
    if (width < 16 || height < 16) return false
    val cx = width * 0.16
    val cy = height * 0.93
    val rx = width * 0.18
    val ry = height * 0.16
    val left = (cx - rx).toInt().coerceIn(0, width - 1)
    val top = (cy - ry).toInt().coerceIn(0, height - 1)
    val right = (cx + rx).toInt().coerceIn(left + 1, width)
    val bottom = (cy + ry).toInt().coerceIn(top + 1, height)
    if (right - left < 4 || bottom - top < 4) return false

    var rgbMat: Mat? = null
    var hsvMat: Mat? = null
    return try {
      rgbMat = Mat()
      when (sourceMat.channels()) {
        4 -> Imgproc.cvtColor(sourceMat, rgbMat, Imgproc.COLOR_RGBA2RGB)
        3 -> sourceMat.copyTo(rgbMat)
        else -> return false
      }
      hsvMat = Mat()
      Imgproc.cvtColor(rgbMat, hsvMat, Imgproc.COLOR_RGB2HSV)

      // Quantize saturated-pixel hues into 12 buckets (15° each in OpenCV's
      // 0-180 hue space). An empty triangle corner contains only one vivid hue
      // (the set-color band) plus low-saturation silver/gray; its saturated
      // pixels cluster in a single bucket. A character portrait contains
      // skin + hair + armor + backdrop — saturated pixels spread across
      // multiple distinct hue buckets.
      val buckets = IntArray(12)
      var saturatedCount = 0
      var totalCount = 0
      for (y in top until bottom) {
        for (x in left until right) {
          val px = hsvMat.get(y, x) ?: continue
          if (px.size < 3) continue
          totalCount++
          val sat = px[1]
          val value = px[2]
          if (sat < 80.0 || value < 60.0) continue
          saturatedCount++
          val hue = px[0].coerceIn(0.0, 179.999)
          val bucket = (hue / 15.0).toInt().coerceIn(0, 11)
          buckets[bucket]++
        }
      }
      if (totalCount < 16 || saturatedCount < 10) {
        Log.d(TAG, "hasPlayerPortraitBubble: too-few-saturated sat=$saturatedCount present=false")
        return false
      }
      val minBucketPopulation = (saturatedCount * 0.08).toInt().coerceAtLeast(3)
      val populatedBuckets = buckets.count { it >= minBucketPopulation }
      val present = populatedBuckets >= 2
      Log.d(TAG, "hasPlayerPortraitBubble: buckets=${buckets.toList()} populated=$populatedBuckets sat=$saturatedCount present=$present (${width}x${height})")
      present
    } catch (_: Throwable) {
      false
    } finally {
      hsvMat?.release()
      rgbMat?.release()
    }
  }

  private fun buildBadgeColorZoneMask(sourceMat: Mat): Mat? {
    var rgbMat: Mat? = null
    var hsvMat: Mat? = null
    var brightNeutralMask: Mat? = null
    var vividAccentMask: Mat? = null
    var combinedMask: Mat? = null
    var kernel: Mat? = null
    return try {
      rgbMat = Mat()
      when (sourceMat.channels()) {
        4 -> Imgproc.cvtColor(sourceMat, rgbMat, Imgproc.COLOR_RGBA2RGB)
        3 -> sourceMat.copyTo(rgbMat)
        else -> return null
      }
      hsvMat = Mat()
      Imgproc.cvtColor(rgbMat, hsvMat, Imgproc.COLOR_RGB2HSV)
      brightNeutralMask = Mat()
      vividAccentMask = Mat()
      Core.inRange(hsvMat, Scalar(0.0, 0.0, 110.0), Scalar(180.0, 95.0, 255.0), brightNeutralMask)
      Core.inRange(hsvMat, Scalar(0.0, 55.0, 60.0), Scalar(180.0, 255.0, 255.0), vividAccentMask)
      combinedMask = Mat()
      Core.bitwise_or(brightNeutralMask, vividAccentMask, combinedMask)
      applyShapeSearchZoneMask(combinedMask, Scalar(0.0))
      val width = combinedMask.width().toDouble()
      val height = combinedMask.height().toDouble()
      if (hasPlayerPortraitBubble(sourceMat)) {
        Imgproc.ellipse(
          combinedMask,
          Point(width * 0.18, height * 0.82),
          Size(width * 0.26, height * 0.30),
          0.0,
          0.0,
          360.0,
          Scalar(0.0),
          -1,
        )
      }
      Imgproc.rectangle(
        combinedMask,
        Point(width * 0.90, height * 0.20),
        Point(width, height * 0.80),
        Scalar(0.0),
        -1,
      )
      kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(9.0, 9.0))
      Imgproc.morphologyEx(combinedMask, combinedMask, Imgproc.MORPH_CLOSE, kernel)
      Imgproc.dilate(combinedMask, combinedMask, kernel)
      combinedMask.clone()
    } catch (_: Throwable) {
      null
    } finally {
      rgbMat?.release()
      hsvMat?.release()
      brightNeutralMask?.release()
      vividAccentMask?.release()
      combinedMask?.release()
      kernel?.release()
    }
  }

  private fun innerContourSelectionScore(contour: MatOfPoint, width: Int, height: Int): Double {
    val area = Imgproc.contourArea(contour).coerceAtLeast(0.0)
    if (area <= 1.0) return 0.0
    val bounds = Imgproc.boundingRect(contour)
    if (bounds.width <= 0 || bounds.height <= 0) return 0.0
    val contour2f = MatOfPoint2f(*contour.toArray())
    val containsCenter =
      try {
        Imgproc.pointPolygonTest(contour2f, Point(width / 2.0, height / 2.0), false) >= 0.0
      } finally {
        contour2f.release()
      }
    if (!containsCenter) return 0.0
    val touchesBorder =
      bounds.x <= 1 ||
        bounds.y <= 1 ||
        (bounds.x + bounds.width) >= (width - 1) ||
        (bounds.y + bounds.height) >= (height - 1)
    if (touchesBorder) return 0.0
    val areaRatio = area / max(1.0, (width * height).toDouble())
    if (areaRatio !in 0.06..0.55) return 0.0
    val contourCx = bounds.x + (bounds.width / 2.0)
    val contourCy = bounds.y + (bounds.height / 2.0)
    val centerDx = kotlin.math.abs((width / 2.0) - contourCx) / max(1.0, width.toDouble())
    val centerDy = kotlin.math.abs((height / 2.0) - contourCy) / max(1.0, height.toDouble())
    val centerPenalty = (centerDx + centerDy).coerceIn(0.0, 1.0)
    val bboxArea = max(1.0, (bounds.width * bounds.height).toDouble())
    val extent = (area / bboxArea).coerceIn(0.0, 1.0)
    val aspectRatio = bounds.height.toDouble() / max(1.0, bounds.width.toDouble())
    val extentPenalty =
      when {
        extent >= 0.92 -> 0.20
        extent >= 0.82 -> 0.55
        else -> 1.0
      }
    val widthPenalty = if (bounds.width < (width * 0.22) || bounds.height < (height * 0.22)) 0.3 else 1.0
    val aspectPenalty =
      when {
        aspectRatio !in 0.78..1.28 -> 0.45
        else -> 1.0
      }
    return area * (1.0 - centerPenalty) * extentPenalty * widthPenalty * aspectPenalty * 1.25
  }

  private fun refineInnerFrameContour(contour: MatOfPoint, width: Int, height: Int): MatOfPoint? {
    var maskMat: Mat? = null
    var closeKernel: Mat? = null
    var openKernel: Mat? = null
    return try {
      maskMat = Mat.zeros(height, width, CvType.CV_8UC1)
      Imgproc.drawContours(maskMat, mutableListOf(contour), -1, Scalar(255.0), Imgproc.FILLED)
      closeKernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(9.0, 9.0))
      openKernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(5.0, 5.0))
      Imgproc.morphologyEx(maskMat, maskMat, Imgproc.MORPH_CLOSE, closeKernel)
      Imgproc.dilate(maskMat, maskMat, openKernel)
      Imgproc.morphologyEx(maskMat, maskMat, Imgproc.MORPH_OPEN, openKernel)
      findLargestContour(maskMat)
    } catch (_: Throwable) {
      null
    } finally {
      maskMat?.release()
      closeKernel?.release()
      openKernel?.release()
    }
  }

  private fun findLargestContour(maskMat: Mat): MatOfPoint? {
    var contourMat: Mat? = null
    var hierarchy: Mat? = null
    return try {
      contourMat = maskMat.clone()
      hierarchy = Mat()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        contourMat,
        contours,
        hierarchy,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      contours.maxByOrNull { Imgproc.contourArea(it) }
    } catch (_: Throwable) {
      null
    } finally {
      contourMat?.release()
      hierarchy?.release()
    }
  }

  private fun applyShapeSearchZoneMask(mat: Mat, fillColor: Scalar) {
    val width = mat.width().toDouble()
    val height = mat.height().toDouble()
    if (width <= 0.0 || height <= 0.0) return
    val insetX = width * 0.05
    val insetY = height * 0.05
    Imgproc.rectangle(mat, Point(0.0, 0.0), Point(width, insetY), fillColor, -1)
    Imgproc.rectangle(mat, Point(0.0, height - insetY), Point(width, height), fillColor, -1)
    Imgproc.rectangle(mat, Point(0.0, 0.0), Point(insetX, height), fillColor, -1)
    Imgproc.rectangle(mat, Point(width - insetX, 0.0), Point(width, height), fillColor, -1)
  }

  private fun contourSelectionScore(contour: MatOfPoint, width: Int, height: Int): Double {
    val area = Imgproc.contourArea(contour).coerceAtLeast(0.0)
    if (area <= 1.0) return 0.0
    val bounds = Imgproc.boundingRect(contour)
    if (bounds.width <= 0 || bounds.height <= 0) return 0.0
    val contourCx = bounds.x + (bounds.width / 2.0)
    val contourCy = bounds.y + (bounds.height / 2.0)
    val centerDx = kotlin.math.abs((width / 2.0) - contourCx) / max(1.0, width.toDouble())
    val centerDy = kotlin.math.abs((height / 2.0) - contourCy) / max(1.0, height.toDouble())
    val centerPenalty = (centerDx + centerDy).coerceIn(0.0, 1.0)
    val bboxArea = max(1.0, (bounds.width * bounds.height).toDouble())
    val extent = (area / bboxArea).coerceIn(0.0, 1.5)
    val touchesBorder =
      bounds.x <= 1 ||
        bounds.y <= 1 ||
        (bounds.x + bounds.width) >= (width - 1) ||
        (bounds.y + bounds.height) >= (height - 1)
    val oversizedBoxinessPenalty =
      if (
        bounds.width >= (width * 0.82) &&
          bounds.height >= (height * 0.82) &&
          extent >= 0.82
      ) {
        0.15
      } else {
        1.0
      }
    val fullExtentPenalty =
      when {
        extent >= 0.97 -> 0.08
        extent >= 0.92 -> 0.18
        extent >= 0.86 -> 0.45
        else -> 1.0
      }
    val borderPenalty = if (touchesBorder) 0.30 else 1.0
    return area * (1.0 - centerPenalty) * oversizedBoxinessPenalty * fullExtentPenalty * borderPenalty
  }

  private fun drawContourOverlayBitmap(source: Bitmap, contour: MatOfPoint?): Bitmap? {
    if (contour == null) return null
    return try {
      val overlay = source.copy(Bitmap.Config.ARGB_8888, true)
      val overlayMat = Mat()
      try {
        Utils.bitmapToMat(overlay, overlayMat)
        Imgproc.drawContours(
          overlayMat,
          mutableListOf(contour),
          -1,
          Scalar(0.0, 255.0, 0.0, 255.0),
          2,
        )
        Utils.matToBitmap(overlayMat, overlay)
      } finally {
        overlayMat.release()
      }
      overlay
    } catch (_: Throwable) {
      null
    }
  }

  private fun buildBestOuterShapeDescriptor(
    contour: MatOfPoint,
    width: Int,
    height: Int,
    cleanupObservedArtifacts: Boolean = false,
  ): SimpleShapeDescriptor? {
    val baseDescriptor =
      buildSimpleShapeDescriptor(
        contour,
        width,
        height,
        cleanupObservedArtifacts = cleanupObservedArtifacts,
      ) ?: return null
    val hullDescriptor =
      buildConvexHullShapeDescriptor(
        contour,
        width,
        height,
        cleanupObservedArtifacts = cleanupObservedArtifacts,
      ) ?: return baseDescriptor
    val baseArea = baseDescriptor.area.coerceAtLeast(1.0)
    val hullExpansion = (hullDescriptor.area / baseArea).coerceAtLeast(1.0)
    if (hullExpansion !in 1.03..1.35) {
      return baseDescriptor
    }

    val baseScores = scoreSimpleShapeRules(baseDescriptor)
    val hullScores = scoreSimpleShapeRules(hullDescriptor)
    val convexShapes = listOf("Triangle", "Diamond", "Square", "Circle")
    val baseConvexScore = convexShapes.maxOfOrNull { baseScores[it] ?: 0.0 } ?: 0.0
    val hullConvexScore = convexShapes.maxOfOrNull { hullScores[it] ?: 0.0 } ?: 0.0
    return if (hullConvexScore >= baseConvexScore + 0.08) hullDescriptor else baseDescriptor
  }

  private fun buildConvexHullShapeDescriptor(
    contour: MatOfPoint,
    width: Int,
    height: Int,
    cleanupObservedArtifacts: Boolean = false,
  ): SimpleShapeDescriptor? {
    val hullIndices = MatOfInt()
    return try {
      Imgproc.convexHull(contour, hullIndices)
      val contourPoints = contour.toArray()
      val hullIndexArray = hullIndices.toArray()
      if (hullIndexArray.isEmpty()) return null
      val hullPoints = ArrayList<Point>(hullIndexArray.size)
      for (rawIndex in hullIndexArray) {
        val index = rawIndex.toInt()
        if (index in contourPoints.indices) {
          hullPoints.add(contourPoints[index])
        }
      }
      if (hullPoints.size < 3) return null
      buildSimpleShapeDescriptor(
        MatOfPoint(*hullPoints.toTypedArray()),
        width,
        height,
        cleanupObservedArtifacts = cleanupObservedArtifacts,
      )
    } catch (_: Throwable) {
      null
    } finally {
      hullIndices.release()
    }
  }

  private fun circleContourSelectionScore(contour: MatOfPoint, width: Int, height: Int): Double {
    val area = Imgproc.contourArea(contour).coerceAtLeast(0.0)
    if (area <= 1.0) return 0.0
    val bounds = Imgproc.boundingRect(contour)
    if (bounds.width <= 0 || bounds.height <= 0) return 0.0
    val bboxArea = max(1.0, (bounds.width * bounds.height).toDouble())
    val extent = (area / bboxArea).coerceIn(0.0, 1.5)
    val contourCx = bounds.x + (bounds.width / 2.0)
    val contourCy = bounds.y + (bounds.height / 2.0)
    val centerDx = kotlin.math.abs((width / 2.0) - contourCx) / max(1.0, width.toDouble())
    val centerDy = kotlin.math.abs((height / 2.0) - contourCy) / max(1.0, height.toDouble())
    val centerPenalty = (centerDx + centerDy).coerceIn(0.0, 1.0)
    val perimeter = Imgproc.arcLength(MatOfPoint2f(*contour.toArray()), true).coerceAtLeast(1.0)
    val circularity = ((4.0 * Math.PI * area) / (perimeter * perimeter)).coerceIn(0.0, 1.0)
    val aspectRatio = bounds.height.toDouble() / max(1.0, bounds.width.toDouble())
    val touchesBorder =
      bounds.x <= 1 ||
        bounds.y <= 1 ||
        (bounds.x + bounds.width) >= (width - 1) ||
        (bounds.y + bounds.height) >= (height - 1)
    val borderPenalty = if (touchesBorder) 0.35 else 1.0
    val extentPenalty =
      when {
        extent >= 0.97 -> 0.05
        extent >= 0.92 -> 0.15
        extent >= 0.86 -> 0.45
        else -> 1.0
      }
    fun near(value: Double, target: Double, tolerance: Double): Double {
      if (tolerance <= 1e-6) return if (kotlin.math.abs(value - target) <= 1e-6) 1.0 else 0.0
      return (1.0 - (kotlin.math.abs(value - target) / tolerance)).coerceIn(0.0, 1.0)
    }
    val roundness =
      (near(circularity, 0.78, 0.24) * 0.55) +
        (near(aspectRatio, 1.0, 0.24) * 0.25) +
        (near(extent, 0.78, 0.18) * 0.20)
    return area * roundness.coerceIn(0.0, 1.0) * (1.0 - centerPenalty) * extentPenalty * borderPenalty
  }

  private fun buildSimpleCircleDescriptorFromHough(sourceMat: Mat?): SimpleShapeDescriptor? {
    if (sourceMat == null || sourceMat.empty()) return null
    var grayMat: Mat? = null
    var blurMat: Mat? = null
    var circlesMat: Mat? = null
    try {
      grayMat = Mat()
      when (sourceMat.channels()) {
        4 -> Imgproc.cvtColor(sourceMat, grayMat, Imgproc.COLOR_RGBA2GRAY)
        3 -> Imgproc.cvtColor(sourceMat, grayMat, Imgproc.COLOR_RGB2GRAY)
        else -> sourceMat.copyTo(grayMat)
      }
      blurMat = Mat()
      Imgproc.GaussianBlur(grayMat, blurMat, Size(5.0, 5.0), 1.5)
      circlesMat = Mat()
      val minDim = minOf(blurMat.width(), blurMat.height()).toDouble()
      Imgproc.HoughCircles(
        blurMat,
        circlesMat,
        Imgproc.HOUGH_GRADIENT,
        1.0,
        minDim * 0.25,
        100.0,
        16.0,
        (minDim * 0.18).toInt(),
        (minDim * 0.42).toInt(),
      )
      if (circlesMat.cols() <= 0) return null

      var bestX = 0.0
      var bestY = 0.0
      var bestRadius = 0.0
      var bestScore = Double.NEGATIVE_INFINITY
      val centerX = blurMat.width() / 2.0
      val centerY = blurMat.height() / 2.0
      for (i in 0 until circlesMat.cols()) {
        val circle = circlesMat.get(0, i) ?: continue
        if (circle.size < 3) continue
        val x = circle[0]
        val y = circle[1]
        val radius = circle[2]
        if (radius <= 1.0) continue
        val centerPenalty =
          (kotlin.math.abs(centerX - x) / max(1.0, blurMat.width().toDouble())) +
            (kotlin.math.abs(centerY - y) / max(1.0, blurMat.height().toDouble()))
        val sizeScore = 1.0 - kotlin.math.abs((radius / max(1.0, minDim * 0.32)) - 1.0)
        val score = (radius * 0.7) + (sizeScore * minDim * 0.3) - (centerPenalty * minDim)
        if (score > bestScore) {
          bestScore = score
          bestX = x
          bestY = y
          bestRadius = radius
        }
      }
      if (bestRadius <= 1.0) return null

      val width = blurMat.width()
      val height = blurMat.height()
      val mask = BooleanArray(width * height)
      val radiusSquared = bestRadius * bestRadius
      for (y in 0 until height) {
        for (x in 0 until width) {
          val dx = x - bestX
          val dy = y - bestY
          if ((dx * dx) + (dy * dy) <= radiusSquared) {
            mask[(y * width) + x] = true
          }
        }
      }
      val normalizedMask = normalizeShapeMask(mask, size)
      val outlineMask = extractOutlineMask(normalizedMask, size)
      val pointCloud = buildOuterShapePointCloud(normalizedMask, outlineMask, size)
      return SimpleShapeDescriptor(
        vertices = 12,
        aspectRatio = 1.0,
        extent = (Math.PI / 4.0).coerceIn(0.0, 1.0),
        circularity = 0.96,
        mask = normalizedMask,
        outlineMask = outlineMask,
        pointCloud = pointCloud,
        area = Math.PI * bestRadius * bestRadius,
        perimeter = 2.0 * Math.PI * bestRadius,
      )
    } catch (_: Throwable) {
      return null
    } finally {
      grayMat?.release()
      blurMat?.release()
      circlesMat?.release()
    }
  }

  private fun buildSimpleShapeDescriptor(
    contour: MatOfPoint,
    width: Int,
    height: Int,
    cleanupObservedArtifacts: Boolean = false,
  ): SimpleShapeDescriptor? {
    val area = Imgproc.contourArea(contour)
    if (area <= 1.0) return null
    val perimeter = Imgproc.arcLength(MatOfPoint2f(*contour.toArray()), true).coerceAtLeast(1.0)
    val bounds = Imgproc.boundingRect(contour)
    if (bounds.width <= 0 || bounds.height <= 0) return null
    val contour2f = MatOfPoint2f(*contour.toArray())
    val approx = MatOfPoint2f()
    Imgproc.approxPolyDP(contour2f, approx, perimeter * 0.02, true)
    val rawMask = rasterizeContourMask(contour, width, height)
    val mask =
      if (cleanupObservedArtifacts) {
        erodeBooleanMask(cleanupObservedShapeMask(rawMask, width, height), width, height, iterations = 1)
      } else {
        rawMask
      }
    val frameMask = carveCenterHole(mask, width, height)
    val normalizedMask = normalizeContourTraceMask(frameMask, width, height, size)
    if (maskDensity(normalizedMask) < 0.05) return null
    val outlineMask = extractOutlineMask(normalizedMask, size)
    val pointCloud = buildOuterShapePointCloud(normalizedMask, outlineMask, size)
    if (pointCloud.isEmpty()) return null
    val aspectRatio = bounds.height.toDouble() / max(1.0, bounds.width.toDouble())
    val extent = area / max(1.0, (bounds.width * bounds.height).toDouble())
    val circularity = ((4.0 * Math.PI * area) / (perimeter * perimeter)).coerceIn(0.0, 1.0)
    return try {
      SimpleShapeDescriptor(
        vertices = approx.toArray().size.coerceAtLeast(0),
        aspectRatio = aspectRatio,
        extent = extent.coerceIn(0.0, 1.5),
        circularity = circularity,
        mask = normalizedMask,
        outlineMask = outlineMask,
        pointCloud = pointCloud,
        area = area,
        perimeter = perimeter,
      )
      } finally {
        contour2f.release()
        approx.release()
      }
    }

  private fun buildSimpleShapeDescriptorFromMatMask(
    maskMat: Mat?,
    cleanupObservedArtifacts: Boolean = false,
  ): SimpleShapeDescriptor? {
    if (maskMat == null || maskMat.empty()) return null
    val width = maskMat.width()
    val height = maskMat.height()
    if (width <= 0 || height <= 0) return null
    val centeredContour = findBestContourInMatMask(maskMat)
    if (centeredContour != null) {
      return buildSimpleShapeDescriptor(
        centeredContour,
        width,
        height,
        cleanupObservedArtifacts = cleanupObservedArtifacts,
      )
    }
    val rawMask = BooleanArray(width * height)
    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1
    var areaCount = 0
    for (y in 0 until height) {
      for (x in 0 until width) {
        val on = (maskMat.get(y, x)?.getOrNull(0) ?: 0.0) > 0.0
        rawMask[(y * width) + x] = on
        if (on) {
          areaCount += 1
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (areaCount <= 0 || maxX < minX || maxY < minY) return null
    val cleanedMask =
      if (cleanupObservedArtifacts) {
        erodeBooleanMask(cleanupObservedShapeMask(rawMask, width, height), width, height, iterations = 1)
      } else {
        rawMask
      }
    return buildSimpleShapeDescriptorFromRawBooleanMask(cleanedMask, width, height)
  }

  private fun buildSimpleShapeDescriptorFromRawBooleanMask(
    mask: BooleanArray,
    width: Int,
    height: Int,
    targetFillRatio: Double = 0.88,
    isolateComponents: Boolean = true,
    shiftRightRatio: Double = 0.0,
    shiftDownRatio: Double = 0.0,
  ): SimpleShapeDescriptor? {
    if (width <= 0 || height <= 0 || mask.size < width * height) return null
    val activeCount = mask.count { it }
    if (activeCount <= 0) return null
    var normalizedTrace = normalizeContourTraceMask(mask, width, height, size, targetFillRatio)
    if (shiftRightRatio != 0.0 || shiftDownRatio != 0.0) {
      normalizedTrace =
        translateMask(
          normalizedTrace,
          size,
          kotlin.math.round((size * shiftRightRatio)).toInt(),
          kotlin.math.round((size * shiftDownRatio)).toInt(),
        )
    }
    val normalizedMask = if (isolateComponents) isolateOuterShape(normalizedTrace, size) else normalizedTrace
    if (maskDensity(normalizedMask) < 0.03) return null
    val outlineMask = extractOutlineMask(normalizedMask, size)
    val pointCloud = buildOuterShapePointCloud(normalizedMask, outlineMask, size).ifEmpty {
      buildFallbackPointCloud(outlineMask, size)
    }
    if (pointCloud.isEmpty()) return null
    val bounds = maskBounds(normalizedMask, size) ?: return null
    val bboxWidth = (bounds[2] - bounds[0] + 1).coerceAtLeast(1)
    val bboxHeight = (bounds[3] - bounds[1] + 1).coerceAtLeast(1)
    val area = normalizedMask.count { it }.toDouble()
    val extent = area / max(1.0, (bboxWidth * bboxHeight).toDouble())
    val perimeter = outlineMask.count { it }.toDouble().coerceAtLeast(1.0)
    val circularity = ((4.0 * Math.PI * area) / (perimeter * perimeter)).coerceIn(0.0, 1.0)

    val outerProfile = buildContourRadiusProfile(outlineMask, size, useNearest = false)
    val turnProfile = buildContourTurnProfile(outerProfile)
    val turnPeaks = turnProfile.count { it >= 0.18 }
    var vertices =
      when {
        turnPeaks >= 10 -> 10
        turnPeaks >= 8 -> 8
        turnPeaks >= 7 -> 7
        turnPeaks >= 6 -> 6
        turnPeaks >= 5 -> 5
        else -> max(3, turnPeaks)
      }

    val contour = buildContourFromMask(normalizedMask, size)
    if (contour != null) {
      val contour2f = MatOfPoint2f(*contour.toArray())
      val approx = MatOfPoint2f()
      try {
        val contourPerimeter = Imgproc.arcLength(contour2f, true).coerceAtLeast(1.0)
        Imgproc.approxPolyDP(contour2f, approx, contourPerimeter * 0.02, true)
        vertices = approx.toArray().size.coerceAtLeast(vertices)
      } finally {
        contour2f.release()
        approx.release()
        contour.release()
      }
    }

    return SimpleShapeDescriptor(
      vertices = vertices,
      aspectRatio = bboxHeight.toDouble() / max(1.0, bboxWidth.toDouble()),
      extent = extent.coerceIn(0.0, 1.5),
      circularity = circularity,
      mask = normalizedMask,
      outlineMask = outlineMask,
      pointCloud = pointCloud,
      area = area,
      perimeter = perimeter,
    )
  }

  private fun findBestContourInMatMask(maskMat: Mat): MatOfPoint? {
    var contourMat: Mat? = null
    var hierarchy: Mat? = null
    return try {
      contourMat = maskMat.clone()
      hierarchy = Mat()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        contourMat,
        contours,
        hierarchy,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      contours
        .asSequence()
        .map { contour -> contour to contourSelectionScore(contour, maskMat.width(), maskMat.height()) }
        .filter { (_, score) -> score > 0.0 }
        .maxByOrNull { it.second }
        ?.first
    } catch (_: Throwable) {
      null
    } finally {
      hierarchy?.release()
      contourMat?.release()
    }
  }

  private fun buildSimpleShapeDescriptorFromBooleanMask(mask: BooleanArray): SimpleShapeDescriptor? {
    val normalizedMask = normalizeShapeMask(mask, size)
    if (maskDensity(normalizedMask) < 0.03) return null
    val outlineMask = extractOutlineMask(normalizedMask, size)
    val pointCloud = buildOuterShapePointCloud(normalizedMask, outlineMask, size).ifEmpty {
      buildFallbackPointCloud(outlineMask, size)
    }
    if (pointCloud.isEmpty()) return null
    val bounds = maskBounds(normalizedMask, size) ?: return null
    val width = (bounds[2] - bounds[0] + 1).coerceAtLeast(1)
    val height = (bounds[3] - bounds[1] + 1).coerceAtLeast(1)
    val area = normalizedMask.count { it }.toDouble()
    val extent = area / max(1.0, (width * height).toDouble())
    val perimeter = outlineMask.count { it }.toDouble().coerceAtLeast(1.0)
    val circularity = ((4.0 * Math.PI * area) / (perimeter * perimeter)).coerceIn(0.0, 1.0)
    val outerProfile = buildContourRadiusProfile(outlineMask, size, useNearest = false)
    val turnProfile = buildContourTurnProfile(outerProfile)
    val turnPeaks = turnProfile.count { it >= 0.18 }
    val vertices =
      when {
        turnPeaks >= 10 -> 10
        turnPeaks >= 8 -> 8
        turnPeaks >= 7 -> 7
        turnPeaks >= 6 -> 6
        turnPeaks >= 5 -> 5
        else -> max(3, turnPeaks)
      }
    return SimpleShapeDescriptor(
      vertices = vertices,
      aspectRatio = height.toDouble() / max(1.0, width.toDouble()),
      extent = extent.coerceIn(0.0, 1.5),
      circularity = circularity,
      mask = normalizedMask,
      outlineMask = outlineMask,
      pointCloud = pointCloud,
      area = area,
      perimeter = perimeter,
    )
  }

  private fun buildFallbackPointCloud(
    outlineMask: BooleanArray,
    dimension: Int,
  ): List<CloudPoint> {
    val sourcePoints =
      outlinePoints(outlineMask, dimension)
        .sortedBy { (x, y) ->
          kotlin.math.atan2(
            y - ((dimension - 1) / 2.0),
            x - ((dimension - 1) / 2.0),
          )
        }
        .map { (x, y) -> CloudPoint(x.toDouble(), y.toDouble()) }
    if (sourcePoints.size < 4) return emptyList()
    return normalizePointCloud(resampleClosedPointCloud(sourcePoints, POINT_CLOUD_SIZE))
  }

  private fun loadBundledShapeReferences(): List<SyntheticShapeReference> {
    return SYNTHETIC_SHAPE_ORDER.mapNotNull { shapeName ->
      val assetPath = SHAPE_REFERENCE_ASSET_NAMES[shapeName] ?: return@mapNotNull null
      val rawMask = loadBundledShapeReferenceMask(assetPath) ?: return@mapNotNull null
      val normalizedMask = normalizeShapeMask(rawMask, size)
      val contour = buildContourFromMask(normalizedMask, size) ?: return@mapNotNull null
      val descriptor = buildSimpleShapeDescriptor(contour, size, size)
        ?: buildSimpleShapeDescriptorFromBooleanMask(normalizedMask)
        ?: return@mapNotNull null
      SyntheticShapeReference(
        name = shapeName,
        contour = contour,
        descriptor = descriptor,
      )
    }
  }

  private fun loadBundledShapeReferenceMask(assetPath: String): BooleanArray? {
    val decoded =
      try {
        context.assets.open(assetPath).use { BitmapFactory.decodeStream(it) }
      } catch (_: Exception) {
        null
      } ?: return null
    val scaled = Bitmap.createScaledBitmap(decoded, size, size, true)
    if (scaled != decoded) {
      decoded.recycle()
    }
    return try {
      val mask = BooleanArray(size * size)
      for (y in 0 until size) {
        for (x in 0 until size) {
          val pixel = scaled.getPixel(x, y)
          val alpha = Color.alpha(pixel)
          val brightness = (Color.red(pixel) + Color.green(pixel) + Color.blue(pixel)) / 3
          mask[(y * size) + x] = alpha >= 32 && brightness >= 96
        }
      }
      mask
    } finally {
      scaled.recycle()
    }
  }

  private fun buildContourFromMask(mask: BooleanArray, dimension: Int): MatOfPoint? {
    var mat: Mat? = null
    var hierarchy: Mat? = null
    return try {
      mat = Mat.zeros(dimension, dimension, CvType.CV_8UC1)
      for (y in 0 until dimension) {
        for (x in 0 until dimension) {
          if (mask[(y * dimension) + x]) {
            mat.put(y, x, 255.0)
          }
        }
      }
      hierarchy = Mat()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        mat,
        contours,
        hierarchy,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      contours.maxByOrNull { Imgproc.contourArea(it) }
    } catch (_: Throwable) {
      null
    } finally {
      hierarchy?.release()
      mat?.release()
    }
  }

  private fun buildContourFromRawMask(
    mask: BooleanArray,
    width: Int,
    height: Int,
    preferInner: Boolean = false,
  ): MatOfPoint? {
    var mat: Mat? = null
    var hierarchy: Mat? = null
    return try {
      mat = Mat.zeros(height, width, CvType.CV_8UC1)
      for (y in 0 until height) {
        for (x in 0 until width) {
          if (mask[(y * width) + x]) {
            mat.put(y, x, 255.0)
          }
        }
      }
      hierarchy = Mat()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        mat,
        contours,
        hierarchy,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      val scored =
        if (preferInner) {
          contours.maxByOrNull { innerContourSelectionScore(it, width, height) }
        } else {
          contours.maxByOrNull { contourSelectionScore(it, width, height) }
        }
      scored
        ?: contours.maxByOrNull { Imgproc.contourArea(it) }
    } catch (_: Throwable) {
      null
    } finally {
      hierarchy?.release()
      mat?.release()
    }
  }

  private fun buildLargestContourFromRawMask(mask: BooleanArray, width: Int, height: Int): MatOfPoint? {
    var mat: Mat? = null
    var hierarchy: Mat? = null
    return try {
      mat = Mat.zeros(height, width, CvType.CV_8UC1)
      for (y in 0 until height) {
        for (x in 0 until width) {
          if (mask[(y * width) + x]) {
            mat.put(y, x, 255.0)
          }
        }
      }
      hierarchy = Mat()
      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(
        mat,
        contours,
        hierarchy,
        Imgproc.RETR_EXTERNAL,
        Imgproc.CHAIN_APPROX_SIMPLE,
      )
      contours.maxByOrNull { Imgproc.contourArea(it) }
    } catch (_: Throwable) {
      null
    } finally {
      hierarchy?.release()
      mat?.release()
    }
  }

  private fun contourDistanceToScore(distance: Double): Double {
    if (!distance.isFinite()) return 0.0
    return (1.0 / (1.0 + (distance * 7.5))).coerceIn(0.0, 1.0)
  }

  private fun scoreBundledShapeProfiles(descriptor: SimpleShapeDescriptor): Map<String, Double> {
    val widthAspect = 1.0 / max(1e-6, descriptor.aspectRatio)
    return BUNDLED_SHAPE_PROFILES.associate { profile ->
      profile.name to scoreBundledShapeProfile(
        profile = profile,
        vertices = descriptor.vertices,
        extent = descriptor.extent,
        circularity = descriptor.circularity,
        aspect = widthAspect,
      )
    }
  }

  private fun scoreBundledShapeProfile(
    profile: BundledShapeProfile,
    vertices: Int,
    extent: Double,
    circularity: Double,
    aspect: Double,
  ): Double {
    val vertexScore =
      when {
        vertices in profile.vertices -> 1.0
        vertices == profile.vertices.first - 1 -> 0.5
        vertices == profile.vertices.last + 1 -> 0.5
        else -> 0.0
      }
    val extentScore = scoreRangeFit(extent, profile.extentRange)
    val circularityScore = scoreRangeFit(circularity, profile.circularityRange)
    val aspectScore = scoreRangeFit(aspect, profile.aspectRange)
    return (
      vertexScore * 0.45 +
        extentScore * 0.25 +
        circularityScore * 0.15 +
        aspectScore * 0.15
      ).coerceIn(0.0, 1.0)
  }

  private fun scoreRangeFit(
    value: Double,
    range: ClosedFloatingPointRange<Double>,
  ): Double {
    if (value in range) return 1.0
    val distance =
      if (value < range.start) {
        range.start - value
      } else {
        value - range.endInclusive
      }
    val rangeSize = (range.endInclusive - range.start).coerceAtLeast(1e-6)
    return max(0.0, 1.0 - (distance / rangeSize))
  }

  private fun rasterizeContourMask(contour: MatOfPoint, width: Int, height: Int): BooleanArray {
    val mat = Mat.zeros(height, width, CvType.CV_8UC1)
    return try {
      Imgproc.drawContours(mat, mutableListOf(contour), -1, Scalar(255.0), Imgproc.FILLED)
      val mask = BooleanArray(width * height)
      for (y in 0 until height) {
        for (x in 0 until width) {
          mask[(y * width) + x] = (mat.get(y, x)?.getOrNull(0) ?: 0.0) > 0.0
        }
      }
      mask
    } finally {
      mat.release()
    }
  }

  /** Approximate a contour with fewer vertices, removing tiny tabs/rivets
   * without flattening real shape corners. Returns null if the input is
   * empty. epsilonRatio is expressed as a fraction of the contour perimeter. */
  private fun simplifyContour(contour: MatOfPoint, epsilonRatio: Double): MatOfPoint? {
    if (contour.empty()) return null
    val contour2f = MatOfPoint2f(*contour.toArray())
    val approx = MatOfPoint2f()
    return try {
      val perimeter = Imgproc.arcLength(contour2f, true)
      if (perimeter <= 0.0) return null
      Imgproc.approxPolyDP(contour2f, approx, perimeter * epsilonRatio, true)
      val pts = approx.toArray()
      if (pts.size < 3) null else MatOfPoint(*pts.map { Point(it.x, it.y) }.toTypedArray())
    } catch (_: Throwable) {
      null
    } finally {
      contour2f.release()
      approx.release()
    }
  }

    private fun buildObservedSilhouetteMask(
      label: String,
      sourceMat: Mat,
      guidingContour: MatOfPoint?,
      width: Int,
      height: Int,
    ): BooleanArray? {
      if (guidingContour != null && label in listOf("outer", "fallback")) {
        val contourDrivenMask = buildContourDrivenSilhouetteMask(sourceMat, guidingContour, width, height)
        if (contourDrivenMask != null) return contourDrivenMask
      }
      val innerCavityMask = buildInnerCavitySilhouetteMask(sourceMat, guidingContour, width, height)
      if (innerCavityMask != null) return innerCavityMask
    var colorZoneMat: Mat? = null
    return try {
      colorZoneMat = buildBadgeColorZoneMask(sourceMat) ?: return null
      if (colorZoneMat.width() != width || colorZoneMat.height() != height) return null

      // Only cut the portrait region when a player-portrait bubble is
      // actually detected at bottom-left. Unconditional cutting was
      // chopping off the triangle's bottom-left vertex on portrait-less
      // mods; unconditional skip was leaving the portrait attached on
      // portrait-present mods and inflating Circle/Arrow scores.
      val portraitPresent = hasPlayerPortraitBubble(sourceMat)
      var workingMask = cleanupObservedShapeMask(
        booleanArrayFromMat(colorZoneMat, width, height),
        width,
        height,
        cutPortrait = portraitPresent,
      )
      if (!workingMask.any { it }) return null

      guidingContour?.let { contour ->
        val contourMask = cleanupObservedShapeMask(
          rasterizeContourMask(contour, width, height),
          width,
          height,
          cutPortrait = portraitPresent,
        )
        val expandedGuide = dilateRawMask(contourMask, width, height, radius = 2)
        val constrainedMask = intersectMasks(workingMask, expandedGuide)
        if (maskDensity(constrainedMask) >= 0.01) {
          workingMask = constrainedMask
        }
      }

      workingMask = closeRawMask(workingMask, width, height, radius = 2)
      workingMask = fillInternalHoles(workingMask, width, height)
      workingMask = cleanupObservedShapeMask(workingMask, width, height, cutPortrait = portraitPresent)
      workingMask = closeRawMask(workingMask, width, height, radius = 1)

      val stabilizedContour = buildContourFromRawMask(workingMask, width, height)
      val stabilizedMask =
        stabilizedContour?.let {
          cleanupObservedShapeMask(
            rasterizeContourMask(it, width, height),
            width,
            height,
            cutPortrait = portraitPresent,
          )
        }
          ?: workingMask
      val finalMask = fillInternalHoles(stabilizedMask, width, height)
      if (finalMask.any { it }) finalMask else null
    } catch (_: Throwable) {
      null
    } finally {
      colorZoneMat?.release()
    }
  }

  private fun buildContourDrivenSilhouetteMask(
    sourceMat: Mat,
    guidingContour: MatOfPoint,
    width: Int,
    height: Int,
  ): BooleanArray? {
    // Smooth small decorative tabs/rivets off the traced contour before
    // rasterizing. approxPolyDP at ~2% perimeter flattens tiny protrusions
    // (tab-sized) while preserving real shape corners — a triangle stays a
    // triangle with 3 vertices, a cross keeps its 12-ish concave vertices.
    // 1% perimeter epsilon: enough to collapse small decorative tabs, but
    // gentle enough to preserve the triangle's pointy top vertex. 2% was
    // flattening the peak into a trapezoid.
    val smoothedContour = simplifyContour(guidingContour, epsilonRatio = 0.01) ?: guidingContour
    var workingMask = cleanupContourDrivenOuterMask(rasterizeContourMask(smoothedContour, width, height), width, height)
    if (!workingMask.any { it }) return null
    val colorBounds =
      buildBadgeColorZoneMask(sourceMat)
        ?.let { mat ->
          try {
            booleanArrayFromMat(mat, width, height)
          } finally {
            mat.release()
          }
        }
        ?.let { rawMaskBounds(it, width, height) }
    if (colorBounds != null) {
      workingMask =
        keepWithinRawBounds(
          workingMask,
          width,
          height,
          colorBounds,
          padX = (width * 0.08).toInt().coerceAtLeast(2),
          padY = (height * 0.08).toInt().coerceAtLeast(2),
        )
    }
    workingMask = closeRawMask(workingMask, width, height, radius = 1)
    workingMask = fillInternalHoles(workingMask, width, height)
    workingMask = cleanupContourDrivenOuterMask(workingMask, width, height)
    val largestContour = buildLargestContourFromRawMask(workingMask, width, height)
    val stabilizedMask =
      largestContour?.let { cleanupContourDrivenOuterMask(rasterizeContourMask(it, width, height), width, height) }
        ?: workingMask
    val finalMask = fillInternalHoles(closeRawMask(stabilizedMask, width, height, radius = 1), width, height)
    return if (maskDensity(finalMask) >= 0.01) finalMask else null
  }

    private fun buildInnerCavitySilhouetteMask(
      sourceMat: Mat,
      guidingContour: MatOfPoint?,
      width: Int,
      height: Int,
    ): BooleanArray? {
      var grayMat: Mat? = null
      var darkMat: Mat? = null
      var colorZoneMat: Mat? = null
      return try {
        grayMat = Mat()
        when (sourceMat.channels()) {
          4 -> Imgproc.cvtColor(sourceMat, grayMat, Imgproc.COLOR_RGBA2GRAY)
          3 -> Imgproc.cvtColor(sourceMat, grayMat, Imgproc.COLOR_RGB2GRAY)
          else -> sourceMat.copyTo(grayMat)
        }
        darkMat = Mat()
        Imgproc.threshold(grayMat, darkMat, 138.0, 255.0, Imgproc.THRESH_BINARY_INV)
        applyShapeSearchZoneMask(darkMat, Scalar(0.0))
        applyInnerBottomBarTrim(darkMat)
        val widthD = width.toDouble()
        val heightD = height.toDouble()
        val portraitPresent = hasPlayerPortraitBubble(sourceMat)
        if (portraitPresent) {
          Imgproc.ellipse(
            darkMat,
            Point(widthD * 0.18, heightD * 0.82),
            Size(widthD * 0.26, heightD * 0.30),
            0.0,
            0.0,
            360.0,
            Scalar(0.0),
            -1,
          )
        }
        Imgproc.rectangle(
          darkMat,
          Point(widthD * 0.84, heightD * 0.20),
          Point(widthD, heightD * 0.80),
          Scalar(0.0),
          -1,
        )
        val centerRadius = (minOf(width, height) * 0.15).coerceAtLeast(5.0)
        Imgproc.circle(
          darkMat,
          Point(widthD / 2.0, heightD / 2.0),
          centerRadius.toInt(),
          Scalar(255.0),
          -1,
        )

        var cavityMask = cleanupInnerObservedMask(booleanArrayFromMat(darkMat, width, height), width, height, cutPortrait = portraitPresent)
        colorZoneMat = buildBadgeColorZoneMask(sourceMat)
        val fallbackBounds = colorZoneMat?.let { booleanArrayFromMat(it, width, height) }?.let { rawMaskBounds(it, width, height) }

        guidingContour?.let { contour ->
          val contourMask = cleanupInnerObservedMask(rasterizeContourMask(contour, width, height), width, height, cutPortrait = portraitPresent)
          val shrunkenGuide = erodeRawMask(contourMask, width, height, radius = 1)
          val constrainedMask = intersectMasks(cavityMask, shrunkenGuide)
          if (maskDensity(constrainedMask) >= 0.01) {
            cavityMask = constrainedMask
          }
        } ?: run {
          if (fallbackBounds != null) {
            cavityMask =
              keepWithinRawBounds(
                cavityMask,
                width,
                height,
                fallbackBounds,
                padX = (width * 0.05).toInt(),
                padY = (height * 0.05).toInt(),
              )
          }
        }

        cavityMask = closeRawMask(cavityMask, width, height, radius = 2)
        cavityMask = fillInternalHoles(cavityMask, width, height)
        cavityMask = cleanupInnerObservedMask(cavityMask, width, height, cutPortrait = portraitPresent)
        cavityMask =
          extractCenterConnectedComponent(cavityMask, width, height)
            ?: extractMostCentralConnectedComponent(cavityMask, width, height)
            ?: return null
        cavityMask = closeRawMask(cavityMask, width, height, radius = 1)
        cavityMask = fillInternalHoles(cavityMask, width, height)
        cavityMask = cleanupInnerObservedMask(cavityMask, width, height, cutPortrait = portraitPresent)

        val cavityContour = buildContourFromRawMask(cavityMask, width, height, preferInner = true) ?: return null
        val stabilizedMask = cleanupInnerObservedMask(rasterizeContourMask(cavityContour, width, height), width, height, cutPortrait = portraitPresent)
        val closedStabilized = closeRawMask(stabilizedMask, width, height, radius = 1)
        val holeFilledMask = fillInternalHoles(closedStabilized, width, height)
        val finalMask = cleanupInnerObservedMask(holeFilledMask, width, height, cutPortrait = portraitPresent)
        if (maskDensity(finalMask) >= 0.01) finalMask else null
      } catch (_: Throwable) {
        null
      } finally {
        grayMat?.release()
        darkMat?.release()
        colorZoneMat?.release()
      }
    }

    private fun extractCenterConnectedComponent(mask: BooleanArray, width: Int, height: Int): BooleanArray? {
      val centerX = width / 2
      val centerY = height / 2
      val maxRadius = max(width, height) / 5
      for (radius in 0..maxRadius) {
        for (dy in -radius..radius) {
          for (dx in -radius..radius) {
            val x = centerX + dx
            val y = centerY + dy
            if (x !in 0 until width || y !in 0 until height) continue
            if (!mask[(y * width) + x]) continue
            return extractConnectedComponent(mask, width, height, x, y)
          }
        }
      }
      return null
    }

    private fun extractMostCentralConnectedComponent(
      mask: BooleanArray,
      width: Int,
      height: Int,
    ): BooleanArray? {
      val visited = BooleanArray(mask.size)
      var bestMask: BooleanArray? = null
      var bestScore = Double.NEGATIVE_INFINITY
      val centerX = (width - 1) / 2.0
      val centerY = (height - 1) / 2.0
      for (y in 0 until height) {
        for (x in 0 until width) {
          val index = (y * width) + x
          if (!mask[index] || visited[index]) continue
          val (componentMask, componentSize, centroidX, centroidY) =
            extractConnectedComponentWithStats(mask, width, height, x, y, visited)
          if (componentSize <= 0) continue
          val normalizedDx = (centroidX - centerX) / max(1.0, width / 2.0)
          val normalizedDy = (centroidY - centerY) / max(1.0, height / 2.0)
          val distancePenalty = sqrt((normalizedDx * normalizedDx) + (normalizedDy * normalizedDy))
          val areaScore = componentSize.toDouble() / max(1.0, (width * height).toDouble())
          val score = areaScore - (distancePenalty * 0.35)
          if (score > bestScore) {
            bestScore = score
            bestMask = componentMask
          }
        }
      }
      return bestMask
    }

    private fun extractConnectedComponent(
      mask: BooleanArray,
      width: Int,
      height: Int,
      startX: Int,
      startY: Int,
    ): BooleanArray {
      return extractConnectedComponentWithStats(mask, width, height, startX, startY, null).first
    }

    private fun extractConnectedComponentWithStats(
      mask: BooleanArray,
      width: Int,
      height: Int,
      startX: Int,
      startY: Int,
      sharedVisited: BooleanArray?,
    ): ConnectedComponentStats {
      val componentMask = BooleanArray(mask.size)
      val localVisited = sharedVisited ?: BooleanArray(mask.size)
      val queue = ArrayDeque<Int>()
      val startIndex = (startY * width) + startX
      queue.addLast(startIndex)
      localVisited[startIndex] = true
      var count = 0
      var sumX = 0.0
      var sumY = 0.0
      while (queue.isNotEmpty()) {
        val index = queue.removeFirst()
        if (!mask[index]) continue
        componentMask[index] = true
        count += 1
        val x = index % width
        val y = index / width
        sumX += x.toDouble()
        sumY += y.toDouble()
        for (dy in -1..1) {
          for (dx in -1..1) {
            if (dx == 0 && dy == 0) continue
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until width || ny !in 0 until height) continue
            val neighborIndex = (ny * width) + nx
            if (localVisited[neighborIndex]) continue
            localVisited[neighborIndex] = true
            if (mask[neighborIndex]) {
              queue.addLast(neighborIndex)
            }
          }
        }
      }
      val centroidX = if (count > 0) sumX / count else startX.toDouble()
      val centroidY = if (count > 0) sumY / count else startY.toDouble()
      return ConnectedComponentStats(componentMask, count, centroidX, centroidY)
    }

    private data class ConnectedComponentStats(
      val first: BooleanArray,
      val second: Int,
      val third: Double,
      val fourth: Double,
    )

  private fun cleanupObservedShapeMask(
    mask: BooleanArray,
    width: Int,
    height: Int,
    portraitScaleX: Double = 1.0,
    portraitScaleY: Double = 1.0,
    trimRightTab: Boolean = true,
    rightTrimLeftRatio: Double = 0.84,
    rightTrimTopRatio: Double = 0.20,
    rightTrimBottomRatio: Double = 0.88,
    cutPortrait: Boolean = false,
  ): BooleanArray {
    val cleaned = mask.copyOf()
    val portraitCenterX = width * 0.22
    val portraitCenterY = height * 0.80
    val portraitRadiusX = ((width * 0.30) * portraitScaleX).coerceAtLeast(5.0)
    val portraitRadiusY = ((height * 0.26) * portraitScaleY).coerceAtLeast(5.0)
    val rightTrimLeft = (width * rightTrimLeftRatio).toInt().coerceIn(0, width)
    val rightTrimTop = (height * rightTrimTopRatio).toInt().coerceIn(0, height)
    val rightTrimBottom = (height * rightTrimBottomRatio).toInt().coerceIn(0, height)
    for (y in 0 until height) {
      for (x in 0 until width) {
        if (cutPortrait) {
          val portraitDx = (x - portraitCenterX) / portraitRadiusX
          val portraitDy = (y - portraitCenterY) / portraitRadiusY
          if ((portraitDx * portraitDx) + (portraitDy * portraitDy) <= 1.0) {
            cleaned[(y * width) + x] = false
            continue
          }
        }
        if (trimRightTab && x >= rightTrimLeft && y in rightTrimTop until rightTrimBottom) {
          cleaned[(y * width) + x] = false
        }
      }
    }
    return cleaned
  }

  private fun cleanupContourDrivenOuterMask(mask: BooleanArray, width: Int, height: Int): BooleanArray {
    // The outer candidate has already been selected by contour score (biggest compact
    // edge contour). When we rasterize that contour to a filled mask it does not
    // contain portrait pixels to begin with — but the old defensive portrait ellipse
    // cut was carving a huge bite out of the triangle's bottom-left corner. Skip the
    // portrait cut for contour-driven masks and trust the selected contour.
    // For the contour-driven outer candidate, trust the selected contour: no
    // portrait cut, no right-flare cut. Those defensive trims were carving
    // notches into the triangle's bottom-left and mid-right edges and tanking
    // the triangle score versus cross/diamond.
    return cleanupObservedShapeMask(
      mask,
      width,
      height,
      trimRightTab = false,
      cutPortrait = false,
    )
  }

  private fun cleanupInnerObservedMask(
    mask: BooleanArray,
    width: Int,
    height: Int,
    cutPortrait: Boolean = true,
  ): BooleanArray {
    val cleaned = cleanupObservedShapeMask(mask, width, height, cutPortrait = cutPortrait)
    return trimInnerBottomBar(cleaned, width, height)
  }

  private fun trimInnerBottomBar(mask: BooleanArray, width: Int, height: Int): BooleanArray {
    val trimmed = mask.copyOf()
    val startX = (width * 0.30).toInt().coerceIn(0, width)
    val startY = (height * 0.84).toInt().coerceIn(0, height)
    for (y in startY until height) {
      for (x in startX until width) {
        trimmed[(y * width) + x] = false
      }
    }
    return trimmed
  }

  private fun dilateRawMask(mask: BooleanArray, width: Int, height: Int, radius: Int): BooleanArray {
    if (radius <= 0) return mask.copyOf()
    val dilated = BooleanArray(mask.size)
    for (y in 0 until height) {
      for (x in 0 until width) {
        if (!mask[(y * width) + x]) continue
        for (dy in -radius..radius) {
          for (dx in -radius..radius) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until width || ny !in 0 until height) continue
            dilated[(ny * width) + nx] = true
          }
        }
      }
    }
    return dilated
  }

  private fun erodeRawMask(mask: BooleanArray, width: Int, height: Int, radius: Int): BooleanArray {
    if (radius <= 0) return mask.copyOf()
    val eroded = BooleanArray(mask.size)
    for (y in 0 until height) {
      for (x in 0 until width) {
        var keep = true
        for (dy in -radius..radius) {
          for (dx in -radius..radius) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until width || ny !in 0 until height || !mask[(ny * width) + nx]) {
              keep = false
              break
            }
          }
          if (!keep) break
        }
        eroded[(y * width) + x] = keep
      }
    }
    return eroded
  }

  private fun closeRawMask(mask: BooleanArray, width: Int, height: Int, radius: Int): BooleanArray {
    if (radius <= 0) return mask.copyOf()
    return erodeRawMask(dilateRawMask(mask, width, height, radius), width, height, radius)
  }

  private fun fillInternalHoles(mask: BooleanArray, width: Int, height: Int): BooleanArray {
    if (width <= 0 || height <= 0 || mask.isEmpty()) return mask.copyOf()
    val outside = BooleanArray(mask.size)
    val queue = ArrayDeque<Int>()

    fun enqueueIfBackground(x: Int, y: Int) {
      if (x !in 0 until width || y !in 0 until height) return
      val index = (y * width) + x
      if (mask[index] || outside[index]) return
      outside[index] = true
      queue.add(index)
    }

    for (x in 0 until width) {
      enqueueIfBackground(x, 0)
      enqueueIfBackground(x, height - 1)
    }
    for (y in 0 until height) {
      enqueueIfBackground(0, y)
      enqueueIfBackground(width - 1, y)
    }

    while (queue.isNotEmpty()) {
      val index = queue.removeFirst()
      val x = index % width
      val y = index / width
      enqueueIfBackground(x - 1, y)
      enqueueIfBackground(x + 1, y)
      enqueueIfBackground(x, y - 1)
      enqueueIfBackground(x, y + 1)
    }

    val filled = mask.copyOf()
    for (index in mask.indices) {
      if (!mask[index] && !outside[index]) {
        filled[index] = true
      }
    }
    return filled
  }

  private fun rawMaskBounds(mask: BooleanArray, width: Int, height: Int): IntArray? {
    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1
    for (y in 0 until height) {
      for (x in 0 until width) {
        if (!mask[(y * width) + x]) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    return if (maxX >= minX && maxY >= minY) intArrayOf(minX, minY, maxX, maxY) else null
  }

  private fun keepWithinRawBounds(
    mask: BooleanArray,
    width: Int,
    height: Int,
    bounds: IntArray,
    padX: Int,
    padY: Int,
  ): BooleanArray {
    if (bounds.size < 4) return mask.copyOf()
    val minX = (bounds[0] - padX).coerceIn(0, width - 1)
    val minY = (bounds[1] - padY).coerceIn(0, height - 1)
    val maxX = (bounds[2] + padX).coerceIn(0, width - 1)
    val maxY = (bounds[3] + padY).coerceIn(0, height - 1)
    val kept = BooleanArray(mask.size)
    for (y in minY..maxY) {
      for (x in minX..maxX) {
        val index = (y * width) + x
        kept[index] = mask[index]
      }
    }
    return kept
  }

  private fun erodeBooleanMask(
    mask: BooleanArray,
    width: Int,
    height: Int,
    iterations: Int,
  ): BooleanArray {
    if (iterations <= 0 || width <= 2 || height <= 2) return mask.copyOf()
    var current = mask.copyOf()
    repeat(iterations) {
      val next = BooleanArray(current.size)
      for (y in 1 until (height - 1)) {
        for (x in 1 until (width - 1)) {
          val index = (y * width) + x
          if (!current[index]) continue
          var keep = true
          for (dy in -1..1) {
            for (dx in -1..1) {
              if (!current[((y + dy) * width) + (x + dx)]) {
                keep = false
                break
              }
            }
            if (!keep) break
          }
          if (keep) {
            next[index] = true
          }
        }
      }
      current = next
    }
    return current
  }

  private fun carveCenterHole(mask: BooleanArray, width: Int, height: Int): BooleanArray {
    val bandIterations =
      ((minOf(width, height) * 0.06).toInt()).coerceIn(1, 6)
    val innerMask = erodeBooleanMask(mask, width, height, iterations = bandIterations)
    val carved = BooleanArray(mask.size)
    for (index in mask.indices) {
      carved[index] = mask[index] && !innerMask[index]
    }
    return carved
  }

  private fun normalizeContourTraceMask(
    mask: BooleanArray,
    sourceWidth: Int,
    sourceHeight: Int,
    targetDimension: Int,
    targetFillRatio: Double = 0.88,
  ): BooleanArray {
    return recenterAndScaleMask(mask, sourceWidth, sourceHeight, targetDimension, targetFillRatio)
  }

  private fun translateMask(mask: BooleanArray, dimension: Int, dx: Int, dy: Int): BooleanArray {
    if (dx == 0 && dy == 0) return mask.copyOf()
    val translated = BooleanArray(mask.size)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val sourceX = x - dx
        val sourceY = y - dy
        if (sourceX !in 0 until dimension || sourceY !in 0 until dimension) continue
        translated[(y * dimension) + x] = mask[(sourceY * dimension) + sourceX]
      }
    }
    return translated
  }

  private fun buildSimpleShapeRuleDebug(descriptor: SimpleShapeDescriptor): SimpleShapeRuleDebug {
    val geometry = buildShapeGeometryMetrics(
      observedMask = descriptor.mask,
      observedOutlineMask = descriptor.outlineMask,
      observedPointCloud = descriptor.pointCloud,
      contourMetrics = buildContourMetrics(
        observedMask = descriptor.mask,
        observedOutlineMask = descriptor.outlineMask,
        observedOuterContourProfile = buildContourRadiusProfile(descriptor.outlineMask, size, useNearest = false),
        observedContourTurnProfile = buildContourTurnProfile(buildContourRadiusProfile(descriptor.outlineMask, size, useNearest = false)),
        smoothedRoundMask = descriptor.mask,
        smoothedRoundOutlineMask = descriptor.outlineMask,
        smoothedRoundOuterContourProfile = buildContourRadiusProfile(descriptor.outlineMask, size, useNearest = false),
        smoothedRoundContourTurnProfile = buildContourTurnProfile(buildContourRadiusProfile(descriptor.outlineMask, size, useNearest = false)),
        dimension = size,
      ),
      triangleBoundaryMetrics = buildTriangleBoundaryMetrics(descriptor.mask, size),
      openCvContourResult = OpenCvContourResult(
        mask = descriptor.mask,
        outlineMask = descriptor.outlineMask,
        pointCloud = descriptor.pointCloud,
        vertices = descriptor.vertices,
        aspectRatio = descriptor.aspectRatio,
        extent = descriptor.extent,
        circularity = descriptor.circularity,
      ),
      dimension = size,
    )

    fun near(value: Double, target: Double, tolerance: Double): Double {
      if (tolerance <= 1e-6) return if (kotlin.math.abs(value - target) <= 1e-6) 1.0 else 0.0
      return (1.0 - (kotlin.math.abs(value - target) / tolerance)).coerceIn(0.0, 1.0)
    }
    fun low(value: Double, floor: Double, ceiling: Double): Double {
      if (value <= floor) return 1.0
      if (value >= ceiling) return 0.0
      return 1.0 - ((value - floor) / (ceiling - floor))
    }

    val circleCircularity = geometry.circularity
    // A circle has high circularity (~1.0); a cross/square have lower. Keep
    // the circularity precondition so we don't zero Circle for actual
    // circles. For genuine crosses this guard needs a companion elsewhere —
    // see squareScore and crossScore tuning notes.
    val circleLooksBoxy =
      geometry.centerBarStrength > 0.72 &&
        geometry.orthogonalDominance > 0.82 &&
        circleCircularity < 0.82
    val circleLooksNotched =
      geometry.asymmetry > 0.90 &&
        descriptor.vertices >= 7 &&
        descriptor.aspectRatio <= 1.18 &&
        descriptor.extent >= 0.62 &&
        descriptor.extent <= 0.84
    val circleLooksDiamondish =
      descriptor.vertices >= 8 &&
        descriptor.aspectRatio <= 1.08 &&
        descriptor.extent >= 0.66 &&
        descriptor.extent <= 0.76 &&
        geometry.centerBarStrength >= 0.74 &&
        geometry.diamondCornerScore >= 0.90
    val circleLooksSquareish =
      descriptor.aspectRatio <= 1.05 &&
        descriptor.extent >= 0.90 &&
        geometry.orthogonalDominance >= 0.88 &&
        descriptor.vertices >= 6
    val squareLooksExplicit =
      circleLooksSquareish &&
        geometry.centerBarStrength >= 0.76 &&
        geometry.centerBarStrength <= 0.90
    val stronglyRound = circleCircularity >= 0.84 && descriptor.aspectRatio <= 1.10
    val circleScore =
      if (
        descriptor.aspectRatio > 1.22 ||
          circleLooksBoxy ||
          circleLooksNotched ||
          circleLooksDiamondish ||
          circleLooksSquareish
      ) {
        0.0
      } else {
        (
          near(circleCircularity, 0.86, 0.18) * 0.60 +
            near(descriptor.aspectRatio, 1.0, 0.24) * 0.16 +
            near(descriptor.extent, 0.78, 0.18) * 0.10 +
            (if (stronglyRound) 1.0 else low(geometry.centerBarStrength, 0.24, 0.72)) * 0.07 +
            (if (stronglyRound) 1.0 else low(geometry.orthogonalDominance, 0.30, 0.82)) * 0.07
          ).coerceIn(0.0, 1.0)
      }

    // A highly circular shape is never a Square. Without this guard, circles
    // pick up accidental Square affinity from aspect≈1.0 + extent≈0.78 +
    // approxPolyDP collapsing the smooth outline down to ~4 vertices.
    val squareScore =
      if (squareLooksExplicit) {
        0.88
      } else if ((stronglyRound || geometry.circularity > 0.88) && !circleLooksSquareish) {
        0.0
      } else {
        (
          near(descriptor.vertices.toDouble(), 4.0, 1.5) * 0.28 +
            near(descriptor.aspectRatio, 1.0, 0.18) * 0.18 +
            near(descriptor.extent, 0.78, 0.18) * 0.18 +
            near(geometry.orthogonalDominance, 1.0, 0.40) * 0.18 +
            low(geometry.circularity, 0.58, 0.84) * 0.12 +
            low(geometry.centerBarStrength, 0.28, 0.78) * 0.06 +
            low(geometry.diamondDiagonalScore, 0.28, 0.72) * 0.08 +
            (if (circleLooksSquareish) 0.18 else 0.0)
          ).coerceIn(0.0, 1.0)
      }

    val diamondScore =
      if (
        descriptor.circularity <= 0.30 &&
          descriptor.aspectRatio >= 1.30 &&
          geometry.centerBarStrength >= 0.45 &&
          geometry.orthogonalDominance >= 0.68
      ) {
        0.0
      } else {
        (
          near(descriptor.vertices.toDouble(), 4.0, 1.5) * 0.22 +
            near(descriptor.aspectRatio, 1.0, 0.18) * 0.16 +
            near(descriptor.extent, 0.50, 0.18) * 0.18 +
            near(geometry.diamondDiagonalScore, 0.78, 0.30) * 0.18 +
            near(geometry.diamondCornerScore, 0.82, 0.30) * 0.18 +
            low(geometry.orthogonalDominance, 0.32, 0.78) * 0.04 +
            low(geometry.centerBarStrength, 0.20, 0.60) * 0.04 +
            (if (circleLooksDiamondish) 0.16 else 0.0)
          ).coerceIn(0.0, 1.0)
      }

    val triangleScore =
      (
        near(descriptor.vertices.toDouble(), 3.0, 1.2) * 0.34 +
          near(descriptor.extent, 0.60, 0.18) * 0.16 +
          near(descriptor.aspectRatio, 1.15, 0.28) * 0.12 +
          near(geometry.triangleScore, 0.70, 0.32) * 0.24 +
          near(geometry.tailSupport, 0.75, 0.30) * 0.14
        ).coerceIn(0.0, 1.0)

    val arrowLooksCompact =
      geometry.asymmetry > 0.82 &&
        descriptor.aspectRatio <= 1.18 &&
        descriptor.extent >= 0.66 &&
        descriptor.vertices >= 7
    val arrowScore =
      if (
        geometry.centerBarStrength >= 0.80 &&
          geometry.orthogonalDominance >= 0.65 &&
          descriptor.extent >= 0.85 &&
          descriptor.aspectRatio <= 1.15
      ) {
        0.0
      } else {
        (
          near(descriptor.vertices.toDouble(), 8.0, 3.5) * 0.18 +
            near(descriptor.aspectRatio, 1.08, 0.20) * 0.14 +
            near(descriptor.extent, 0.74, 0.14) * 0.16 +
            near(geometry.asymmetry, 0.92, 0.22) * 0.30 +
            (if (arrowLooksCompact) 0.22 else 0.0)
          ).coerceIn(0.0, 1.0)
      }

    val crossScore =
      (
        near(descriptor.vertices.toDouble(), 12.0, 7.0) * 0.18 +
          low(descriptor.circularity, 0.24, 0.62) * 0.14 +
          near(descriptor.aspectRatio, 1.0, 0.80) * 0.10 +
          near(descriptor.extent, 0.55, 0.20) * 0.12 +
          near(geometry.orthogonalDominance, 0.95, 0.40) * 0.20 +
          near(geometry.centerBarStrength, 0.60, 0.28) * 0.20 +
          (if (
            geometry.centerBarStrength >= 0.80 &&
              geometry.orthogonalDominance >= 0.65 &&
              descriptor.extent >= 0.45 &&
              descriptor.extent <= 0.82 &&
              descriptor.vertices >= 8 &&
              descriptor.aspectRatio <= 1.15
          ) 0.24 else 0.0) +
          (if (
            descriptor.circularity <= 0.30 &&
              descriptor.aspectRatio >= 1.30 &&
              geometry.centerBarStrength >= 0.45 &&
              geometry.orthogonalDominance >= 0.68
          ) 0.16 else 0.0)
        ).coerceIn(0.0, 1.0)

    return SimpleShapeRuleDebug(
      scores =
        linkedMapOf(
          "Circle" to circleScore,
          "Square" to squareScore,
          "Diamond" to diamondScore,
          "Triangle" to triangleScore,
          "Arrow" to arrowScore,
          "Cross" to crossScore,
        ),
      geometry = geometry,
      circleLooksBoxy = circleLooksBoxy,
      circleLooksNotched = circleLooksNotched,
      circleLooksDiamondish = circleLooksDiamondish,
      circleLooksSquareish = circleLooksSquareish,
      squareLooksExplicit = squareLooksExplicit,
      stronglyRound = stronglyRound,
      arrowLooksCompact = arrowLooksCompact,
    )
  }

  private fun scoreSimpleShapeRules(descriptor: SimpleShapeDescriptor): Map<String, Double> =
    buildSimpleShapeRuleDebug(descriptor).scores

  private fun scoreSimpleCircleRule(descriptor: SimpleShapeDescriptor): Double {
    if (descriptor.extent <= 0.05 || descriptor.circularity <= 0.05 || descriptor.pointCloud.isEmpty()) {
      return 0.0
    }
    fun near(value: Double, target: Double, tolerance: Double): Double {
      if (tolerance <= 1e-6) return if (kotlin.math.abs(value - target) <= 1e-6) 1.0 else 0.0
      return (1.0 - (kotlin.math.abs(value - target) / tolerance)).coerceIn(0.0, 1.0)
    }
    val circleLike =
      (
        near(descriptor.circularity, 0.78, 0.24) * 0.48 +
          near(descriptor.aspectRatio, 1.0, 0.22) * 0.24 +
          near(descriptor.extent, 0.78, 0.18) * 0.28
        ).coerceIn(0.0, 1.0)
    return if (descriptor.extent >= 0.95) 0.0 else circleLike
  }

  private fun buildShapeObservation(
    normalizedMask: BooleanArray,
    outlineMask: BooleanArray,
    pointCloud: List<CloudPoint>,
    rawGray: IntArray,
  ): ShapeObservation {
    val outerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = false)
    val innerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = true)
    val contourTurnProfile = buildContourTurnProfile(outerContourProfile)
    val contourThicknessProfile = buildContourThicknessProfile(outerContourProfile, innerContourProfile)
    return ShapeObservation(
      mask = normalizedMask.copyOf(),
      outlineMask = outlineMask.copyOf(),
      pointCloud = pointCloud.toList(),
      outerContourProfile = outerContourProfile,
      innerContourProfile = innerContourProfile,
      contourTurnProfile = contourTurnProfile,
      contourThicknessProfile = contourThicknessProfile,
      rowProfile = rowProfile(normalizedMask, size),
      columnProfile = columnProfile(normalizedMask, size),
      mainDiagonalProfile = mainDiagonalProfile(normalizedMask, size),
      antiDiagonalProfile = antiDiagonalProfile(normalizedMask, size),
      featureVector = buildShapeFeatureVector(normalizedMask, outlineMask, size),
      rawGray = rawGray.copyOf(),
    )
  }

  private fun scoreShapeTemplate(
    observedMask: BooleanArray,
    observedOutlineMask: BooleanArray,
    observedPointCloud: List<CloudPoint>,
    observedOuterContourProfile: DoubleArray,
    observedInnerContourProfile: DoubleArray,
    observedContourTurnProfile: DoubleArray,
    observedContourThicknessProfile: DoubleArray,
    observedContourMetrics: ContourMetrics,
    observedRowProfile: DoubleArray,
    observedColumnProfile: DoubleArray,
    observedMainDiagonalProfile: DoubleArray,
    observedAntiDiagonalProfile: DoubleArray,
    observedFeatureVector: DoubleArray,
    observedRawGray: IntArray,
    roundBoundaryMetrics: RoundBoundaryMetrics,
    triangleBoundaryMetrics: TriangleBoundaryMetrics,
    template: ShapeTemplate,
    includeGeometryBonus: Boolean,
  ): Double {
    val silhouetteScore = compareShapeMasks(observedMask, template.mask, size)
    val outlineScore = compareShapeMasks(observedOutlineMask, template.outlineMask, size)
    val contourRadiusScore =
      (
        compareProfiles(observedOuterContourProfile, template.outerContourProfile) +
          compareProfiles(observedInnerContourProfile, template.innerContourProfile)
        ) / 2.0
    val contourShapeScore =
      (
        compareProfiles(observedContourTurnProfile, template.contourTurnProfile) +
          compareProfiles(observedContourThicknessProfile, template.contourThicknessProfile)
        ) / 2.0
    val structureScore = (
      compareProfiles(observedRowProfile, template.rowProfile) +
        compareProfiles(observedColumnProfile, template.columnProfile) +
        compareProfiles(observedMainDiagonalProfile, template.mainDiagonalProfile) +
        compareProfiles(observedAntiDiagonalProfile, template.antiDiagonalProfile)
      ) / 4.0
    val featureScore = compareProfiles(observedFeatureVector, template.featureVector)
    val rawGrayScore = template.rawGray?.let { compareGrayArrays(observedRawGray, it) } ?: 0.0
    val pointCloudScore = comparePointClouds(observedPointCloud, template.pointCloud)
    val geometryScore = if (includeGeometryBonus) shapeGeometryBonus(template.name, observedMask, size) else 0.0
    val silhouetteWeight =
      when (template.name) {
        "Cross" -> 0.34
        "Circle" -> 0.36
        else -> 0.38
      }
    val outlineWeight =
      when (template.name) {
        "Cross" -> 0.34
        "Circle" -> 0.28
        else -> 0.26
      }
    val structureWeight =
      when (template.name) {
        "Cross", "Circle" -> 0.14
        else -> 0.12
      }
    val featureWeight =
      when (template.name) {
        "Cross" -> 0.10
        else -> 0.08
      }
    val rawGrayWeight =
      when (template.name) {
        "Triangle", "Diamond" -> 0.16
        "Cross" -> 0.14
        "Circle" -> 0.12
        else -> 0.16
      }
    val pointCloudWeight =
      when (template.name) {
        "Triangle", "Diamond" -> 0.22
        "Cross", "Circle" -> 0.18
        else -> 0.18
      }
    val contourRadiusWeight =
      when (template.name) {
        "Circle" -> 0.28
        "Diamond" -> 0.26
        "Triangle" -> 0.22
        "Cross" -> 0.12
        else -> 0.20
      }
    val contourShapeWeight =
      when (template.name) {
        "Cross" -> 0.28
        "Triangle" -> 0.18
        "Circle" -> 0.10
        "Diamond" -> 0.10
        else -> 0.14
      }
    val diamondCornerScore = diamondCornerLayoutScore(observedOutlineMask, size)
    val diamondDiagonalScore = diamondDiagonalEdgeScore(observedOutlineMask, size)
    val crossPenalty = crossOrthogonalPenalty(observedMask, size)
    val diamondEvidenceBoost = if (template.name == "Diamond") {
      ((diamondCornerScore * 0.12) + (diamondDiagonalScore * 0.14) - (crossPenalty * 0.16)).coerceIn(-0.14, 0.18)
    } else {
      0.0
    }
    val contourMetricAdjustment =
      when (template.name) {
        "Circle" -> {
          var adjustment = 0.0
          if (observedContourMetrics.circularity >= 0.74) adjustment += 0.08
          if (observedContourMetrics.ellipseFitQuality >= 0.70) adjustment += 0.08
          if (observedContourMetrics.cornerCount <= 6) adjustment += 0.05
          if (observedContourMetrics.smoothedCircularity >= 0.68) adjustment += 0.12
          if (observedContourMetrics.smoothedEllipseFitQuality >= 0.62) adjustment += 0.10
          if (observedContourMetrics.smoothedCornerCount <= 6) adjustment += 0.05
          val gatedRoundScore = roundBoundaryMetrics.score * (1.0 - (roundBoundaryMetrics.crossVeto * 0.85))
          adjustment += (gatedRoundScore * 0.24)
          adjustment += (roundBoundaryMetrics.coverage * 0.05)
          adjustment += (roundBoundaryMetrics.symmetry * 0.04)
          adjustment -= (roundBoundaryMetrics.radiusStd * 0.10)
          adjustment += (observedContourMetrics.smoothedOrthogonalDominance * -0.08)
          adjustment += ((observedContourMetrics.diagonalDominance * -0.08) + (observedContourMetrics.orthogonalDominance * -0.04))
          adjustment
        }
        "Diamond" -> {
          var adjustment = 0.0
          if (observedContourMetrics.cornerCount in 3..5) adjustment += 0.07
          if (observedContourMetrics.smoothedCornerCount == 4) adjustment += 0.06
          adjustment += (diamondCornerScore * 0.07)
          adjustment += (diamondDiagonalScore * 0.08)
          adjustment += (observedContourMetrics.diagonalDominance * 0.10)
          adjustment -= (observedContourMetrics.orthogonalDominance * 0.08)
          adjustment -= (observedContourMetrics.circularity * 0.10)
          adjustment -= (observedContourMetrics.smoothedCircularity * 0.14)
          adjustment -= (observedContourMetrics.smoothedEllipseFitQuality * 0.08)
          adjustment -= (roundBoundaryMetrics.score * 0.10)
          adjustment
        }
        "Cross" -> {
          var adjustment = 0.0
          if (observedContourMetrics.cornerCount >= 6) adjustment += 0.04
          adjustment += (observedContourMetrics.orthogonalDominance * 0.09)
          adjustment -= (observedContourMetrics.circularity * 0.05)
          adjustment -= (observedContourMetrics.diagonalDominance * 0.05)
          adjustment += (roundBoundaryMetrics.crossVeto * 0.10)
          adjustment -= (roundBoundaryMetrics.score * 0.03)
          adjustment -= (triangleBoundaryMetrics.score * 0.04)
          adjustment
        }
        "Triangle" -> {
          var adjustment = 0.0
          if (observedContourMetrics.cornerCount in 3..4) adjustment += 0.04
          adjustment += (observedContourMetrics.diagonalDominance * 0.04)
          adjustment -= (observedContourMetrics.circularity * 0.03)
          if (observedContourMetrics.smoothedCornerCount >= 4) adjustment -= 0.10
          adjustment += (triangleBoundaryMetrics.score * 0.10)
          adjustment += (triangleBoundaryMetrics.apexNarrowness * 0.05)
          adjustment += (triangleBoundaryMetrics.baseWidth * 0.04)
          adjustment += (triangleBoundaryMetrics.tailSupport * 0.10)
          adjustment -= ((1.0 - triangleBoundaryMetrics.tailSupport) * 0.08)
          adjustment += (triangleBoundaryMetrics.centering * 0.03)
          adjustment -= (diamondCornerScore * 0.08)
          adjustment -= (diamondDiagonalScore * 0.10)
          adjustment
        }
        else -> 0.0
      }.coerceIn(-0.16, 0.16)
    return (
      (silhouetteScore * (silhouetteWeight - 0.08)) +
        (outlineScore * (outlineWeight - 0.06)) +
        (contourRadiusScore * contourRadiusWeight) +
        (contourShapeScore * contourShapeWeight) +
        (structureScore * structureWeight) +
        (featureScore * featureWeight) +
        (rawGrayScore * rawGrayWeight) +
        (pointCloudScore * pointCloudWeight) +
        diamondEvidenceBoost +
        contourMetricAdjustment +
        geometryScore
      )
  }

  private fun loadShapeTemplates(): List<ShapeTemplate> {
    return SHAPE_ASSET_NAMES.mapNotNull { (shapeName, assetPath) ->
      val rawMask = loadTemplate(assetPath) ?: return@mapNotNull null
      val normalizedMask = normalizeShapeMask(rawMask, size)
      val mask = normalizedMask
      val outlineMask = extractOutlineMask(normalizedMask, size)
      val outerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = false)
      val innerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = true)
      ShapeTemplate(
        name = shapeName,
        mask = mask,
        outlineMask = outlineMask,
        pointCloud = buildOuterShapePointCloud(mask, outlineMask, size),
        outerContourProfile = outerContourProfile,
        innerContourProfile = innerContourProfile,
        contourTurnProfile = buildContourTurnProfile(outerContourProfile),
        contourThicknessProfile = buildContourThicknessProfile(outerContourProfile, innerContourProfile),
        rowProfile = rowProfile(mask, size),
        columnProfile = columnProfile(mask, size),
        mainDiagonalProfile = mainDiagonalProfile(mask, size),
        antiDiagonalProfile = antiDiagonalProfile(mask, size),
        featureVector = buildShapeFeatureVector(mask, outlineMask, size),
        rawGray = buildTemplateShapeGray(assetPath, size),
      )
    }
  }

  private fun learnedShapeTemplates(): Map<String, List<LearnedShapePrototype>> {
    cachedLearnedShapePrototypes?.let { return it }
    synchronized(this) {
      cachedLearnedShapePrototypes?.let { return it }
      val built = buildLearnedShapeTemplates()
      cachedLearnedShapePrototypes = built
      return built
    }
  }

  private fun buildLearnedShapeTemplates(): Map<String, List<LearnedShapePrototype>> {
    val learnedSamples = loadShapeSamples()
    if (learnedSamples.isEmpty()) return emptyMap()

    return learnedSamples.mapValues { (shapeName, samples) ->
      clusterShapeSamples(samples)
        .sortedByDescending { it.size }
        .take(SHAPE_MAX_LEARNED_PROTOTYPES_PER_SHAPE)
        .map { cluster ->
          LearnedShapePrototype(
            template = buildShapeTemplate(shapeName, cluster),
            sampleCount = cluster.size,
            rawGraySampleCount = cluster.count { it.rawGray != null },
          )
        }
    }
  }

  private fun clusterShapeSamples(samples: List<ShapeObservation>): List<List<ShapeObservation>> {
    if (samples.isEmpty()) return emptyList()
    val clusters = mutableListOf<MutableList<ShapeObservation>>()
    samples.forEach { sample ->
      var bestCluster: MutableList<ShapeObservation>? = null
      var bestSimilarity = Double.NEGATIVE_INFINITY
      clusters.forEach { cluster ->
        val similarity = scoreShapeObservationSimilarity(sample, buildShapeObservationPrototype(cluster))
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity
          bestCluster = cluster
        }
      }
      if (bestCluster != null && bestSimilarity >= SHAPE_LEARNED_CLUSTER_THRESHOLD) {
        bestCluster?.add(sample)
      } else {
        clusters += mutableListOf(sample)
      }
    }
    return clusters
  }

  private fun buildShapeObservationPrototype(samples: List<ShapeObservation>): ShapeObservation {
    val sampleCount = samples.size.toDouble()
    val mask = BooleanArray(size * size) { index ->
      samples.count { it.mask.getOrNull(index) == true }.toDouble() / sampleCount >= 0.50
    }
    val outlineMask = extractOutlineMask(mask, size)
    val diagonalSize = (size * 2) - 1
    return ShapeObservation(
      mask = mask,
      outlineMask = outlineMask,
      pointCloud = buildOuterShapePointCloud(mask, outlineMask, size),
      outerContourProfile = DoubleArray(CONTOUR_PROFILE_BUCKETS) { index ->
        samples.sumOf { it.outerContourProfile.getOrElse(index) { 0.0 } } / sampleCount
      },
      innerContourProfile = DoubleArray(CONTOUR_PROFILE_BUCKETS) { index ->
        samples.sumOf { it.innerContourProfile.getOrElse(index) { 0.0 } } / sampleCount
      },
      contourTurnProfile = DoubleArray(CONTOUR_PROFILE_BUCKETS) { index ->
        samples.sumOf { it.contourTurnProfile.getOrElse(index) { 0.0 } } / sampleCount
      },
      contourThicknessProfile = DoubleArray(CONTOUR_PROFILE_BUCKETS) { index ->
        samples.sumOf { it.contourThicknessProfile.getOrElse(index) { 0.0 } } / sampleCount
      },
      rowProfile = DoubleArray(size) { index -> samples.sumOf { it.rowProfile.getOrElse(index) { 0.0 } } / sampleCount },
      columnProfile = DoubleArray(size) { index -> samples.sumOf { it.columnProfile.getOrElse(index) { 0.0 } } / sampleCount },
      mainDiagonalProfile = DoubleArray(diagonalSize) { index ->
        samples.sumOf { it.mainDiagonalProfile.getOrElse(index) { 0.0 } } / sampleCount
      },
      antiDiagonalProfile = DoubleArray(diagonalSize) { index ->
        samples.sumOf { it.antiDiagonalProfile.getOrElse(index) { 0.0 } } / sampleCount
      },
      featureVector = DoubleArray(samples.first().featureVector.size) { index ->
        samples.sumOf { it.featureVector.getOrElse(index) { 0.0 } } / sampleCount
      },
      rawGray = samples.firstOrNull { it.rawGray != null }?.rawGray?.let { firstGray ->
        IntArray(firstGray.size) { index ->
          samples.mapNotNull { it.rawGray?.getOrNull(index) }.average().toInt()
        }
      },
    )
  }

  private fun buildShapeTemplate(shapeName: String, samples: List<ShapeObservation>): ShapeTemplate {
    val prototype = buildShapeObservationPrototype(samples)
    return ShapeTemplate(
      name = shapeName,
      mask = prototype.mask,
      outlineMask = prototype.outlineMask,
      pointCloud = prototype.pointCloud,
      outerContourProfile = prototype.outerContourProfile,
      innerContourProfile = prototype.innerContourProfile,
      contourTurnProfile = prototype.contourTurnProfile,
      contourThicknessProfile = prototype.contourThicknessProfile,
      rowProfile = prototype.rowProfile,
      columnProfile = prototype.columnProfile,
      mainDiagonalProfile = prototype.mainDiagonalProfile,
      antiDiagonalProfile = prototype.antiDiagonalProfile,
      featureVector = prototype.featureVector,
      rawGray = prototype.rawGray,
    )
  }

  private fun scoreShapeObservationSimilarity(
    observed: ShapeObservation,
    prototype: ShapeObservation,
  ): Double {
    val silhouetteScore = compareShapeMasks(observed.mask, prototype.mask, size)
    val outlineScore = compareShapeMasks(observed.outlineMask, prototype.outlineMask, size)
    val contourScore =
      (
        compareProfiles(observed.outerContourProfile, prototype.outerContourProfile) +
          compareProfiles(observed.innerContourProfile, prototype.innerContourProfile) +
          compareProfiles(observed.contourTurnProfile, prototype.contourTurnProfile) +
          compareProfiles(observed.contourThicknessProfile, prototype.contourThicknessProfile)
        ) / 4.0
    val pointCloudScore = comparePointClouds(observed.pointCloud, prototype.pointCloud)
    val structureScore = (
      compareProfiles(observed.rowProfile, prototype.rowProfile) +
        compareProfiles(observed.columnProfile, prototype.columnProfile) +
        compareProfiles(observed.mainDiagonalProfile, prototype.mainDiagonalProfile) +
        compareProfiles(observed.antiDiagonalProfile, prototype.antiDiagonalProfile)
      ) / 4.0
    val featureScore = compareProfiles(observed.featureVector, prototype.featureVector)
    val rawGrayScore = if (observed.rawGray != null && prototype.rawGray != null) {
      compareGrayArrays(observed.rawGray, prototype.rawGray)
    } else {
      0.0
    }
    return (
      (silhouetteScore * 0.18) +
        (outlineScore * 0.16) +
        (contourScore * 0.42) +
        (pointCloudScore * 0.10) +
        (structureScore * 0.12) +
        (featureScore * 0.04) +
        (rawGrayScore * 0.08)
      )
  }

  private data class SetDetectionResult(
    val name: String?,
    val score: Double,
    val topMatches: List<MatchScore>,
    val profile: String? = null,
    val observedPrimaryMask: BooleanArray? = null,
    val observedEdgeMask: BooleanArray? = null,
    val observedGray: IntArray? = null,
    val burstPatch: DoubleArray? = null,
    val debugText: String? = null,
    val peakRawConfidence: Double = 0.0,
    val peakRawWinner: String? = null,
  )

  private data class ArrowBurstObservation(
    val patch: DoubleArray,
    val upperRightMark: Double,
    val centerStroke: Double,
    val centerFill: Double,
    val centerDensity: Double,
    val coolBlueBias: Double,
    val cyanBias: Double,
    val saturationLevel: Double,
  )

  private data class ArrowBurstTemplate(
    val patch: DoubleArray,
    val metrics: DoubleArray,
    val colorMetrics: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0),
  )

  private data class ArrowBurstLearnedPrototype(
    val template: ArrowBurstTemplate,
    val sampleCount: Int,
  )

  private fun detectSet(iconBitmap: Bitmap, preferredProfiles: List<String> = emptyList()): SetDetectionResult {
    var bestResult = SetDetectionResult(null, 0.0, emptyList())
    val activeSetTemplates = extendedSetTemplates ?: setTemplates
    val activeLearnedSetModels = learnedSetModels
    val profilesToEvaluate = preferredProfiles
      .filter { SET_CROP_PROFILES.contains(it) }
      .distinct()
      .ifEmpty { SET_CROP_PROFILES }

    val classScoreAccumulator: MutableMap<String, MutableList<Double>> = mutableMapOf()
    val rawPeakPerClass: MutableMap<String, Double> = mutableMapOf()
    var overallPeakRaw = 0.0
    var overallPeakRawWinner: String? = null
    val setDebugAccum = StringBuilder()

    profilesToEvaluate.forEach { profile ->
      cropSetSymbolVariants(iconBitmap, profile).forEach { symbolBitmap ->
        val observedMasks = listOf(
          buildObservedSymbolMask(symbolBitmap, profile),
          buildObservedSymbolEdgeMask(symbolBitmap, profile),
        )
        val scoredMatches = mutableListOf<MatchScore>()
        val scoreBreakdown = mutableListOf<String>()
        val observedPrimaryMask = observedMasks.first()
        val observedEdgeMask = observedMasks.last()
        val observedGray = buildObservedGrayscale(symbolBitmap, setSymbolSize)
        val observedRowProfile = rowProfile(observedPrimaryMask, setSymbolSize)
        val observedColumnProfile = columnProfile(observedPrimaryMask, setSymbolSize)
        val observedEdgeRowProfile = rowProfile(observedEdgeMask, setSymbolSize)
        val observedEdgeColumnProfile = columnProfile(observedEdgeMask, setSymbolSize)
        val observedFeatureProfile = symbolFeatureProfile(
          observedPrimaryMask,
          observedEdgeMask,
          setSymbolSize,
          profile,
        )
        val observedModelFeatures = buildModelFeatureVector(
          observedPrimaryMask,
          observedEdgeMask,
          observedGray,
          observedRowProfile,
          observedColumnProfile,
          observedEdgeRowProfile,
          observedEdgeColumnProfile,
          observedFeatureProfile,
          setSymbolSize,
          profile,
        )
        val rawTemplateResult = scoreBitmapAgainstRawTemplates(symbolBitmap, profile)
        val modelScoresBySet = rawTemplateResult.probabilities
        rawTemplateResult.rawScores.forEach { (name, score) ->
          val existing = rawPeakPerClass[name] ?: Double.NEGATIVE_INFINITY
          if (score > existing) rawPeakPerClass[name] = score
        }
        if (rawTemplateResult.peakRaw > overallPeakRaw) {
          overallPeakRaw = rawTemplateResult.peakRaw
          overallPeakRawWinner = rawTemplateResult.peakWinner
        }
        val burstDecision = if (profile == "arrow") {
          arrowBurstDecision(
            bitmap = symbolBitmap,
            gray = observedGray,
            primaryMask = observedPrimaryMask,
            dimension = setSymbolSize,
          )
        } else {
          null
        }

        activeSetTemplates.forEach { (setName, template) ->
          val isArrowBurstSet = profile == "arrow" && isArrowBurstSet(setName)
          val candidateVariants = template.variants.filter { variant ->
            variant.profile == profile || variant.profile == "generic"
          }.ifEmpty { template.variants }
          val bestVariant = candidateVariants.maxByOrNull { variant ->
            val primaryMaskScore = compareSetMasks(observedPrimaryMask, variant.mask, setSymbolSize)
            val edgeMaskScore = compareSetMasks(observedEdgeMask, variant.edgeMask, setSymbolSize)
            val maskScore = (primaryMaskScore * 0.72) + (edgeMaskScore * 0.28)
            val grayScore = compareGrayArrays(observedGray, variant.gray)
            val rowScore = compareProfiles(observedRowProfile, variant.rowProfile)
            val columnScore = compareProfiles(observedColumnProfile, variant.columnProfile)
            val edgeRowScore = compareProfiles(observedEdgeRowProfile, variant.edgeRowProfile)
            val edgeColumnScore = compareProfiles(observedEdgeColumnProfile, variant.edgeColumnProfile)
            val structureScore = (rowScore + columnScore + edgeRowScore + edgeColumnScore) / 4.0
            val featureScore = compareProfiles(observedFeatureProfile, variant.featureProfile)
            val occupancyScore = compareOccupancy(observedPrimaryMask, variant.mask)
            val centroidScore = compareCentroids(observedPrimaryMask, variant.mask, setSymbolSize)
            scoreSetVariant(
              maskScore = maskScore,
              grayScore = grayScore,
              rowScore = structureScore,
              columnScore = structureScore,
              featureScore = featureScore,
              occupancyScore = occupancyScore,
              centroidScore = centroidScore,
              source = variant.source,
              profile = variant.profile,
            )
          }
          val variantScore = bestVariant?.let { variant ->
            val primaryMaskScore = compareSetMasks(observedPrimaryMask, variant.mask, setSymbolSize)
            val edgeMaskScore = compareSetMasks(observedEdgeMask, variant.edgeMask, setSymbolSize)
            val maskScore = (primaryMaskScore * 0.72) + (edgeMaskScore * 0.28)
            val grayScore = compareGrayArrays(observedGray, variant.gray)
            val rowScore = compareProfiles(observedRowProfile, variant.rowProfile)
            val columnScore = compareProfiles(observedColumnProfile, variant.columnProfile)
            val edgeRowScore = compareProfiles(observedEdgeRowProfile, variant.edgeRowProfile)
            val edgeColumnScore = compareProfiles(observedEdgeColumnProfile, variant.edgeColumnProfile)
            val structureScore = (rowScore + columnScore + edgeRowScore + edgeColumnScore) / 4.0
            val featureScore = compareProfiles(observedFeatureProfile, variant.featureProfile)
            val occupancyScore = compareOccupancy(observedPrimaryMask, variant.mask)
            val centroidScore = compareCentroids(observedPrimaryMask, variant.mask, setSymbolSize)
            scoreSetVariant(
              maskScore = maskScore,
              grayScore = grayScore,
              rowScore = structureScore,
              columnScore = structureScore,
              featureScore = featureScore,
              occupancyScore = occupancyScore,
              centroidScore = centroidScore,
              source = variant.source,
              profile = variant.profile,
            )
          } ?: 0.0
          val geometryScore = if (
            isArrowBurstSet
          ) {
            0.0
          } else if (
            bestVariant?.source?.startsWith("real") == true ||
            bestVariant?.source?.startsWith("learned") == true ||
            bestVariant?.source?.startsWith("trained") == true
          ) {
            0.0
          } else {
            setGeometryBonus(setName, observedPrimaryMask, setSymbolSize)
          }
          val arrowFeatureBonus = if (profile == "arrow" && !isArrowBurstSet) {
              arrowSetFeatureBonus(
                setName = setName,
                primaryMask = observedPrimaryMask,
                edgeMask = observedEdgeMask,
                gray = observedGray,
                featureProfile = observedFeatureProfile,
                dimension = setSymbolSize,
              )
            } else {
              0.0
          }
          val fallbackScore = variantScore + geometryScore + arrowFeatureBonus
          val modelScore = modelScoresBySet[setName]
          val burstTieBreak = if (profile == "arrow") {
            arrowBurstTieBreakScore(
              setName = setName,
              gray = observedGray,
              primaryMask = observedPrimaryMask,
              dimension = setSymbolSize,
            )
          } else {
            0.0
          }
          val burstPatchScore = if (profile == "arrow" && isArrowBurstSet) {
            arrowBurstObservedPatchScore(
              setName = setName,
              gray = observedGray,
              dimension = setSymbolSize,
            )
          } else {
            0.0
          }
          val effectiveModelScore = modelScore
          val score = if (effectiveModelScore != null) {
            if (profile == "arrow") {
              (effectiveModelScore * 1.10) + (fallbackScore * 0.46)
            } else {
              (effectiveModelScore * 1.25) + (fallbackScore * 0.18)
            }
          } else {
            if (isArrowBurstSet) {
              val directScore = burstDecision?.scores?.get(setName) ?: 0.0
              (directScore * 0.72) + (fallbackScore * 0.28) + (burstTieBreak * 0.80) + (burstPatchScore * 0.95)
            } else {
              fallbackScore + burstTieBreak + burstPatchScore
            }
          }
          val labeledName = when {
            effectiveModelScore != null -> "$setName [model-$profile]"
            bestVariant != null -> "$setName [${bestVariant.source}]"
            else -> setName
          }
          scoredMatches += MatchScore(labeledName, score)
          scoreBreakdown += String.format(
            java.util.Locale.US,
            "%s model=%s variant=%.3f geom=%.3f arrowFB=%.3f burstTB=%.3f burstPatch=%.3f final=%.3f src=%s",
            setName,
            effectiveModelScore?.let { String.format(java.util.Locale.US, "%.3f", it) } ?: "null",
            variantScore,
            geometryScore,
            arrowFeatureBonus,
            burstTieBreak,
            burstPatchScore,
            score,
            bestVariant?.source ?: "none",
          )
        }

        val sortedMatches = scoredMatches.sortedByDescending { it.score }
        Log.d(TAG, "setScore profile=$profile --- breakdown ---")
        setDebugAccum.append("profile=").append(profile).append(" rawPeak=").append(rawTemplateResult.peakWinner)
          .append(':').append(String.format(java.util.Locale.US, "%.3f", rawTemplateResult.peakRaw))
          .append(" margin=").append(String.format(java.util.Locale.US, "%.3f", rawTemplateResult.peakMargin)).append('\n')
        scoreBreakdown
          .sortedByDescending { line ->
            Regex("final=([-\\d.]+)").find(line)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
          }
          .forEach {
            Log.d(TAG, "setScore $it")
            setDebugAccum.append(it).append('\n')
          }
        scoredMatches.forEach { match ->
          val baseName = match.name.substringBefore(" [")
          classScoreAccumulator.getOrPut(baseName) { mutableListOf() }.add(match.score)
        }
        val bestMatch = sortedMatches.firstOrNull()
        val secondBestScore = sortedMatches.getOrNull(1)?.score ?: 0.0
        val bestScore = bestMatch?.score ?: 0.0
        val clearWinner = (bestScore - secondBestScore) >= 0.012
        val confidentWinner = bestScore >= 0.18
        val selectedName =
          if (bestScore >= 0.13 && (clearWinner || confidentWinner)) {
            bestMatch?.name?.substringBefore(" [")
          } else {
            null
          }
        val candidate = SetDetectionResult(
          name = selectedName,
          score = bestScore,
          topMatches = sortedMatches.take(4),
          profile = profile,
          observedPrimaryMask = observedPrimaryMask.copyOf(),
          observedEdgeMask = observedEdgeMask.copyOf(),
          observedGray = observedGray.copyOf(),
          burstPatch = if (profile == "arrow") burstDecision?.patch?.copyOf() else null,
          debugText =
            if (profile == "arrow") {
              buildString {
                append(burstDecision?.toDebugText().orEmpty())
                appendLine("selected=$selectedName")
                appendLine("selectedScore=$bestScore")
                appendLine("clearWinner=$clearWinner")
                appendLine("confidentWinner=$confidentWinner")
                sortedMatches.take(4).forEachIndexed { index, match ->
                  appendLine("top${index + 1}=${match.name}:${match.score}")
                }
              }
            } else {
              null
            },
        )

        if (candidate.score > bestResult.score) {
          bestResult = candidate
        }

        symbolBitmap.recycle()
      }
    }

    if (classScoreAccumulator.isNotEmpty()) {
      val aggregates = classScoreAccumulator.mapValues { (_, scores) ->
        val sorted = scores.sortedDescending()
        val topK = sorted.take(kotlin.math.max(1, sorted.size / 2))
        topK.average()
      }
      val ranked = aggregates.entries.sortedByDescending { it.value }
      Log.d(TAG, "setScore aggregate --- across ${classScoreAccumulator.values.firstOrNull()?.size ?: 0} variants ---")
      ranked.take(6).forEach { (name, avg) ->
        Log.d(TAG, "setScore aggregate $name avg(topHalf)=${String.format(java.util.Locale.US, "%.3f", avg)}")
      }
      val aggregateWinner = ranked.firstOrNull()
      if (aggregateWinner != null && aggregateWinner.key != bestResult.name) {
        val winnerScores = classScoreAccumulator[aggregateWinner.key].orEmpty()
        val runnerUpAvg = ranked.getOrNull(1)?.value ?: 0.0
        val marginOk = aggregateWinner.value >= runnerUpAvg * 1.08 || (aggregateWinner.value - runnerUpAvg) >= 0.04
        if (marginOk && winnerScores.any { it >= 0.18 }) {
          Log.d(TAG, "setScore aggregate override: ${bestResult.name} -> ${aggregateWinner.key}")
          bestResult = bestResult.copy(
            name = aggregateWinner.key,
            score = winnerScores.maxOrNull() ?: bestResult.score,
          )
        }
      }
    }

    if (overallPeakRaw >= 0.55 && overallPeakRawWinner != null && overallPeakRawWinner != bestResult.name) {
      val peakRunnerUp = rawPeakPerClass.entries
        .filter { it.key != overallPeakRawWinner }
        .maxOfOrNull { it.value } ?: 0.0
      val rawMargin = overallPeakRaw - peakRunnerUp
      if (rawMargin >= 0.05) {
        Log.d(TAG, "setScore rawPeak override: ${bestResult.name} -> $overallPeakRawWinner (peak=${String.format(java.util.Locale.US, "%.3f", overallPeakRaw)}, margin=${String.format(java.util.Locale.US, "%.3f", rawMargin)})")
        val winnerAgg = classScoreAccumulator[overallPeakRawWinner].orEmpty()
        bestResult = bestResult.copy(
          name = overallPeakRawWinner,
          score = winnerAgg.maxOrNull() ?: bestResult.score,
          peakRawConfidence = overallPeakRaw,
          peakRawWinner = overallPeakRawWinner,
        )
      } else {
        bestResult = bestResult.copy(
          peakRawConfidence = overallPeakRaw,
          peakRawWinner = overallPeakRawWinner,
        )
      }
    } else {
      bestResult = bestResult.copy(
        peakRawConfidence = overallPeakRaw,
        peakRawWinner = overallPeakRawWinner,
      )
    }

    if (
      bestResult.profile != null &&
      bestResult.observedPrimaryMask != null &&
      bestResult.observedEdgeMask != null &&
      bestResult.observedGray != null
    ) {
      writeObservedRasterDebug(
        profile = bestResult.profile,
        primaryMask = bestResult.observedPrimaryMask,
        edgeMask = bestResult.observedEdgeMask,
        gray = bestResult.observedGray,
        debugText = bestResult.debugText,
      )
    }

    if (
      bestResult.profile == "arrow" &&
      bestResult.burstPatch != null &&
      bestResult.debugText != null
    ) {
      val debugObservation = parseArrowBurstObservation(bestResult.debugText, bestResult.burstPatch)
      if (debugObservation != null) {
        lastArrowBurstObservation = debugObservation
      }
    }

    try {
      val outDir = context.getExternalFilesDir(null)
      if (outDir != null) {
        outDir.mkdirs()
        val setDebugFile = java.io.File(outDir, "set-debug-last.txt")
        val header = "===detectSet call=== timestamp=${System.currentTimeMillis()}\nwinner=${bestResult.name}\nscore=${bestResult.score}\npeakRaw=${bestResult.peakRawConfidence}\npeakRawWinner=${bestResult.peakRawWinner}\n"
        setDebugFile.appendText(header + setDebugAccum.toString())
      }
    } catch (_: Throwable) {
    }

    return bestResult
  }

  private fun setProfilesForShape(shapeName: String?): List<String> {
    return when (shapeName?.trim()) {
      "Arrow" -> listOf("arrow")
      "Triangle" -> listOf("triangle")
      "Square", "Diamond", "Circle", "Cross" -> listOf("generic")
      else -> listOf("generic")
    }
  }

  private fun ensureExtendedAssetsWarmUp() {
    if (extendedAssetsWarmUpStarted) {
      return
    }
    synchronized(this) {
      if (extendedAssetsWarmUpStarted) {
        return
      }
      extendedAssetsWarmUpStarted = true
    }

    Thread({
      try {
        extendedSetTemplates = loadSetTemplates(includeLearnedAssets = true)
      } catch (_: Exception) {
      }
      try {
        learnedSetModels = loadLearnedSetModels()
      } catch (_: Exception) {
      }
      try {
        rawTemplateStore = loadRawImageTemplates()
      } catch (_: Exception) {
      }
    }, "ModIconClassifierWarmup").start()
  }

  private fun rawTemplateWindowMask(profile: String, dim: Int): BooleanArray {
    val mask = BooleanArray(dim * dim)
    val cxRatio = 0.50
    val cyRatio = when (profile) {
      "arrow" -> 0.52
      "triangle" -> 0.62
      else -> 0.54
    }
    val rxRatio = when (profile) {
      "arrow" -> 0.26
      "triangle" -> 0.22
      else -> 0.26
    }
    val ryRatio = when (profile) {
      "arrow" -> 0.22
      "triangle" -> 0.20
      else -> 0.22
    }
    val cx = dim * cxRatio
    val cy = dim * cyRatio
    val rx = dim * rxRatio
    val ry = dim * ryRatio
    for (y in 0 until dim) {
      for (x in 0 until dim) {
        val dx = (x - cx) / rx
        val dy = (y - cy) / ry
        mask[y * dim + x] = (dx * dx + dy * dy) <= 1.0
      }
    }
    return mask
  }

  private fun normalizedGrayscaleTemplate(bitmap: Bitmap, dim: Int, profile: String = "generic"): FloatArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, dim, dim, true)
    val windowMask = rawTemplateWindowMask(profile, dim)
    val floats = FloatArray(dim * dim)
    var sum = 0.0
    var count = 0
    for (y in 0 until dim) {
      for (x in 0 until dim) {
        val idx = y * dim + x
        if (!windowMask[idx]) {
          floats[idx] = 0f
          continue
        }
        val luma = luminance(scaled.getPixel(x, y)).toFloat()
        floats[idx] = luma
        sum += luma
        count += 1
      }
    }
    if (scaled !== bitmap) scaled.recycle()
    if (count == 0) return floats
    val mean = (sum / count).toFloat()
    var variance = 0.0
    for (i in floats.indices) {
      if (windowMask[i]) {
        val d = floats[i] - mean
        variance += (d * d).toDouble()
      }
    }
    val std = kotlin.math.sqrt(variance / count).toFloat().coerceAtLeast(1e-3f)
    for (i in floats.indices) {
      floats[i] = if (windowMask[i]) (floats[i] - mean) / std else 0f
    }
    return floats
  }

  private fun loadRawImageTemplates(): Map<String, Map<String, List<FloatArray>>> {
    val byProfile = mutableMapOf<String, MutableMap<String, MutableList<FloatArray>>>()
    loadLearnedSampleDescriptors().forEach { descriptor ->
      try {
        context.assets.open(descriptor.assetPath).use { stream ->
          val bitmap = BitmapFactory.decodeStream(stream) ?: return@use
          val tpl = normalizedGrayscaleTemplate(bitmap, rawTemplateDim, descriptor.profile)
          bitmap.recycle()
          byProfile
            .getOrPut(descriptor.profile) { mutableMapOf() }
            .getOrPut(descriptor.setName) { mutableListOf() }
            .add(tpl)
        }
      } catch (_: Exception) {
      }
    }
    return byProfile.mapValues { (_, sets) ->
      sets.mapValues { (_, list) -> list.toList() }
    }
  }

  private data class RawTemplateScores(
    val probabilities: Map<String, Double>,
    val rawScores: Map<String, Double>,
    val peakRaw: Double,
    val peakWinner: String?,
    val peakMargin: Double,
  )

  private fun scoreBitmapAgainstRawTemplates(bitmap: Bitmap, profile: String): RawTemplateScores {
    val store = rawTemplateStore
    val templates = store?.get(profile) ?: emptyMap()
    if (templates.isEmpty()) return RawTemplateScores(emptyMap(), emptyMap(), 0.0, null, 0.0)
    val observed = normalizedGrayscaleTemplate(bitmap, rawTemplateDim, profile)
    val windowMask = rawTemplateWindowMask(profile, rawTemplateDim)
    val windowCount = windowMask.count { it }.coerceAtLeast(1)
    val rawScores = templates.mapValues { (_, list) ->
      list.maxOfOrNull { tpl ->
        var dot = 0.0
        for (i in observed.indices) {
          if (windowMask[i]) dot += observed[i] * tpl[i]
        }
        dot / windowCount
      } ?: 0.0
    }
    val sorted = rawScores.entries.sortedByDescending { it.value }
    val peakEntry = sorted.firstOrNull()
    val peakRaw = peakEntry?.value ?: 0.0
    val peakWinner = peakEntry?.key
    val peakMargin = peakRaw - (sorted.getOrNull(1)?.value ?: peakRaw)
    val temperature = 20.0
    val exps = rawScores.mapValues { (_, v) -> kotlin.math.exp((v - peakRaw) * temperature) }
    val sum = exps.values.sum()
    val probabilities = if (sum <= 0.0) emptyMap() else exps.mapValues { (_, v) -> v / sum }
    Log.d(
      TAG,
      "rawTemplate profile=$profile peak=$peakWinner:${String.format(java.util.Locale.US, "%.3f", peakRaw)} margin=${String.format(java.util.Locale.US, "%.3f", peakMargin)} top=${sorted.take(4).joinToString(",") { "${it.key}:${String.format(java.util.Locale.US, "%.3f", it.value)}" }}",
    )
    return RawTemplateScores(probabilities, rawScores, peakRaw, peakWinner, peakMargin)
  }

  fun rememberValidatedArrowBurst(setName: String) {
    if (!isArrowBurstSet(setName)) {
      return
    }

    val observation = lastArrowBurstObservation
    if (observation == null) {
      return
    }

    try {
      val sampleFile = File(context.filesDir, ARROW_BURST_SAMPLE_FILENAME)
      val existing = loadArrowBurstSamples(sampleFile).toMutableMap()
      val samples = existing.getOrPut(setName) { mutableListOf() }
      samples += observation
      while (samples.size > ARROW_BURST_MAX_SAMPLES_PER_SET) {
        samples.removeAt(0)
      }
      writeArrowBurstSamples(sampleFile, existing)
    } catch (_: Exception) {
    }
  }

  fun rememberValidatedShape(shapeName: String) {
    if (!SHAPE_ASSET_NAMES.containsKey(shapeName)) {
      return
    }

    val inMemoryObservation = lastShapeObservation
    val persistedObservation = loadLatestShapeObservation()
    val observation = inMemoryObservation ?: persistedObservation
    if (observation == null) {
      appendShapeSaveDebug(
        buildString {
          appendLine("shapeName=$shapeName")
          appendLine("saved=false")
          appendLine("reason=no-observation")
        }
      )
      return
    }

    try {
      val existing = loadShapeSamples().toMutableMap()
      val samples = existing.getOrPut(shapeName) { mutableListOf() }
      samples += observation
      while (samples.size > SHAPE_MAX_SAMPLES_PER_SET) {
        samples.removeAt(0)
      }
      writeShapeSamples(existing)
      writeShapeCropExport(shapeName, observation)
      cachedLearnedShapePrototypes = null
      appendShapeSaveDebug(
        buildString {
          appendLine("shapeName=$shapeName")
          appendLine("saved=true")
          appendLine("usedInMemory=${inMemoryObservation != null}")
          appendLine("usedPersistedFallback=${inMemoryObservation == null && persistedObservation != null}")
          SHAPE_ASSET_NAMES.keys.forEach { knownShape ->
            appendLine("${knownShape}Count=${existing[knownShape]?.size ?: 0}")
          }
        }
      )
    } catch (_: Exception) {
      appendShapeSaveDebug(
        buildString {
          appendLine("shapeName=$shapeName")
          appendLine("saved=false")
          appendLine("reason=write-exception")
        }
      )
    }
  }

  // Emit the full per-shape debug block to logcat AND a public file we can
  // pull over adb without `run-as` (release builds aren't debuggable, so the
  // private files dir is unreadable). Tag "ModShapeDebug" for logcat filter.
  private fun dumpShapeDebug(debugText: String) {
    if (debugText.isBlank()) return
    val stamp = System.currentTimeMillis()
    try {
      debugText.lineSequence().forEach { line ->
        if (line.isNotBlank()) Log.i("ModShapeDebug", line)
      }
      Log.i("ModShapeDebug", "---end $stamp---")
    } catch (_: Throwable) {
    }
    try {
      val outDir = context.getExternalFilesDir(null) ?: return
      outDir.mkdirs()
      val file = java.io.File(outDir, "shape-debug-last.txt")
      file.writeText("timestamp=$stamp\n$debugText")
    } catch (_: Throwable) {
    }
  }

  private fun cropSetSymbolRegion(iconBitmap: Bitmap, leftRatio: Float, topRatio: Float, widthRatio: Float, heightRatio: Float): Bitmap {
    val width = iconBitmap.width
    val height = iconBitmap.height
    val left = (width * leftRatio).toInt().coerceIn(0, width - 1)
    val top = (height * topRatio).toInt().coerceIn(0, height - 1)
    val cropWidth = (width * widthRatio).toInt().coerceAtLeast(1).coerceAtMost(width - left)
    val cropHeight = (height * heightRatio).toInt().coerceAtLeast(1).coerceAtMost(height - top)
    return Bitmap.createBitmap(iconBitmap, left, top, cropWidth, cropHeight)
  }

  private fun cropSetSymbolVariants(iconBitmap: Bitmap, profile: String): List<Bitmap> {
    val variants = when (profile) {
      "arrow" -> listOf(
        floatArrayOf(0.12f, 0.20f, 0.44f, 0.50f),
        floatArrayOf(0.10f, 0.18f, 0.46f, 0.52f),
        floatArrayOf(0.14f, 0.22f, 0.42f, 0.48f),
        floatArrayOf(0.08f, 0.16f, 0.48f, 0.54f),
      )
      "triangle" -> listOf(
        floatArrayOf(0.12f, 0.20f, 0.44f, 0.50f),
        floatArrayOf(0.10f, 0.18f, 0.46f, 0.52f),
        floatArrayOf(0.14f, 0.22f, 0.42f, 0.48f),
        floatArrayOf(0.08f, 0.16f, 0.48f, 0.54f),
      )
      else -> listOf(
        floatArrayOf(0.18f, 0.39f, 0.28f, 0.28f),
        floatArrayOf(0.17f, 0.37f, 0.30f, 0.30f),
        floatArrayOf(0.15f, 0.36f, 0.32f, 0.32f),
      )
    }

    return variants.map { variant ->
      cropSetSymbolRegion(iconBitmap, variant[0], variant[1], variant[2], variant[3])
    }
  }

  private fun loadTemplate(assetPath: String): BooleanArray? {
    return try {
      context.assets.open(assetPath).use { stream ->
        val bitmap = BitmapFactory.decodeStream(stream) ?: return null
        val mask = buildTemplateMask(bitmap)
        bitmap.recycle()
        mask
      }
    } catch (_: Exception) {
      null
    }
  }

  private data class SetTemplate(
    val variants: List<SetTemplateVariant>,
  )

  private data class SetTemplateVariant(
    val source: String,
    val profile: String,
    val mask: BooleanArray,
    val edgeMask: BooleanArray,
    val gray: IntArray,
    val rowProfile: DoubleArray,
    val columnProfile: DoubleArray,
    val edgeRowProfile: DoubleArray,
    val edgeColumnProfile: DoubleArray,
    val featureProfile: DoubleArray,
  )

  private data class LearnedSampleDescriptor(
    val setName: String,
    val profile: String,
    val assetPath: String,
  )

  private data class LearnedTrainingSample(
    val setName: String,
    val profile: String,
    val assetPath: String,
    val features: DoubleArray,
    val primaryMask: BooleanArray,
    val edgeMask: BooleanArray,
    val gray: IntArray,
  )

  private data class LearnedProfileModel(
    val profile: String,
    val labels: List<String>,
    val weights: Array<DoubleArray>,
    val biases: DoubleArray,
    val mean: DoubleArray,
    val scale: DoubleArray,
  ) {
    fun scoreByLabel(features: DoubleArray): Map<String, Double> {
      if (labels.isEmpty()) return emptyMap()
      val normalized = DoubleArray(features.size) { index ->
        (features[index] - mean[index]) / scale[index]
      }
      val logits = DoubleArray(labels.size) { classIndex ->
        var total = biases[classIndex]
        val classWeights = weights[classIndex]
        for (featureIndex in normalized.indices) {
          total += classWeights[featureIndex] * normalized[featureIndex]
        }
        total
      }
      val maxLogit = logits.maxOrNull() ?: 0.0
      val expValues = DoubleArray(logits.size)
      var expTotal = 0.0
      for (index in logits.indices) {
        val expValue = kotlin.math.exp(logits[index] - maxLogit)
        expValues[index] = expValue
        expTotal += expValue
      }
      if (expTotal <= 0.0) return emptyMap()
      return labels.mapIndexed { index, label ->
        label to (expValues[index] / expTotal)
      }.toMap()
    }
  }

  private fun loadSetTemplates(includeLearnedAssets: Boolean): Map<String, SetTemplate> {
    val templates = linkedMapOf<String, SetTemplate>()
    val templateVariants = mutableMapOf<String, MutableList<SetTemplateVariant>>()

    if (includeLearnedAssets) {
      loadLearnedSetTemplateAssets(templateVariants)
    }
    loadRealSetTemplateAssets(templateVariants, REAL_SET_TEMPLATE_ASSETS, profile = "generic", source = "real")
    PROFILE_REAL_SET_TEMPLATE_ASSETS.forEach { (profile, profileAssets) ->
      loadRealSetTemplateAssets(
        templateVariants,
        profileAssets,
        profile = profile,
        source = "real-$profile",
      )
    }

    listOf(SET_ATLAS_ASSET_PATH, SET_ATLAS_FADED_ASSET_PATH).forEach { assetPath ->
      val atlasSource = if (assetPath == SET_ATLAS_ASSET_PATH) "atlas" else "atlas-faded"
      try {
        context.assets.open(assetPath).use { stream ->
          val atlas = BitmapFactory.decodeStream(stream) ?: return@use
          val tileWidth = atlas.width / SET_ATLAS_COLUMNS
          val tileHeight = atlas.height / SET_ATLAS_ROWS

          for (rowIndex in 0 until SET_ATLAS_ROWS) {
            SET_ATLAS_COLUMN_NAMES.forEachIndexed { columnIndex, setName ->
              val rect = Rect(
                columnIndex * tileWidth,
                rowIndex * tileHeight,
                minOf(atlas.width, (columnIndex + 1) * tileWidth),
                minOf(atlas.height, (rowIndex + 1) * tileHeight),
              )
              val tile = Bitmap.createBitmap(atlas, rect.left, rect.top, rect.width(), rect.height())
              val variants = templateVariants.getOrPut(setName) { mutableListOf() }
              val keepAtlasVariant = !variants.any { variant ->
                variant.profile == "generic" &&
                  (
                    variant.source.startsWith("real") ||
                      variant.source.startsWith("learned") ||
                      variant.source.startsWith("trained")
                    )
              }
              if (keepAtlasVariant) {
                variants.add(
                  createSetTemplateVariant(
                    bitmap = tile,
                    source = atlasSource,
                    profile = "generic",
                  )
                )
              }
              tile.recycle()
            }
          }

          atlas.recycle()
        }
      } catch (_: Exception) {
      }
    }

    if (templateVariants.isEmpty()) {
      return emptyMap()
    }

    templateVariants.forEach { (setName, variants) ->
      templates[setName] = SetTemplate(variants = variants)
    }

    return templates
  }

  private fun loadRealSetTemplateAssets(
    templateVariants: MutableMap<String, MutableList<SetTemplateVariant>>,
    assets: Map<String, String>,
    profile: String,
    source: String,
  ) {
    assets.forEach { (setName, assetPath) ->
      val existingVariants = templateVariants[setName].orEmpty()
      val learnedProfileExists = existingVariants.any { variant ->
        variant.profile == profile &&
          (variant.source.startsWith("learned") || variant.source.startsWith("trained"))
      }
      if (learnedProfileExists) {
        return@forEach
      }

      try {
        context.assets.open(assetPath).use { stream ->
          val bitmap = BitmapFactory.decodeStream(stream) ?: return@use
          templateVariants.getOrPut(setName) { mutableListOf() }.add(
            createSetTemplateVariant(
              bitmap = bitmap,
              source = source,
              profile = profile,
            )
          )
          bitmap.recycle()
        }
      } catch (_: Exception) {
      }
    }
  }

  private fun loadLearnedSetTemplateAssets(
    templateVariants: MutableMap<String, MutableList<SetTemplateVariant>>,
  ) {
    data class LearnedAccumulator(
      val setName: String,
      val profile: String,
      val maskTotals: IntArray,
      val edgeMaskTotals: IntArray,
      val grayTotals: DoubleArray,
      val rowTotals: DoubleArray,
      val columnTotals: DoubleArray,
      val edgeRowTotals: DoubleArray,
      val edgeColumnTotals: DoubleArray,
      val featureTotals: DoubleArray,
      var sampleCount: Int = 0,
    )

    try {
      context.assets.open(LEARNED_SET_MANIFEST_ASSET_PATH).use { stream ->
        val manifest = JSONObject(stream.bufferedReader().use { it.readText() })
        val samples = manifest.optJSONArray("samples") ?: return@use
        val accumulators = linkedMapOf<String, LearnedAccumulator>()

        for (index in 0 until samples.length()) {
          val sample = samples.optJSONObject(index) ?: continue
          val setName = sample.optString("set")
          val profile = sample.optString("profile", "generic")
          val relativePath = sample.optString("relativePath")
          if (setName.isBlank() || relativePath.isBlank()) continue

          val assetPath = "$LEARNED_SET_ASSET_DIR/$relativePath"
          try {
            context.assets.open(assetPath).use { sampleStream ->
              val bitmap = BitmapFactory.decodeStream(sampleStream) ?: return@use
              val mask = buildObservedSymbolMask(bitmap, profile)
              val edgeMask = buildObservedSymbolEdgeMask(bitmap, profile)
              val gray = buildObservedGrayscale(bitmap, setSymbolSize)
              val rows = rowProfile(mask, setSymbolSize)
              val columns = columnProfile(mask, setSymbolSize)
              val edgeRows = rowProfile(edgeMask, setSymbolSize)
              val edgeColumns = columnProfile(edgeMask, setSymbolSize)
              val featureProfile = symbolFeatureProfile(mask, edgeMask, setSymbolSize, profile)
              val key = "$profile::$setName"
              val accumulator = accumulators.getOrPut(key) {
                LearnedAccumulator(
                  setName = setName,
                  profile = profile,
                  maskTotals = IntArray(mask.size),
                  edgeMaskTotals = IntArray(edgeMask.size),
                  grayTotals = DoubleArray(gray.size),
                  rowTotals = DoubleArray(rows.size),
                  columnTotals = DoubleArray(columns.size),
                  edgeRowTotals = DoubleArray(edgeRows.size),
                  edgeColumnTotals = DoubleArray(edgeColumns.size),
                  featureTotals = DoubleArray(featureProfile.size),
                )
              }

              accumulator.sampleCount += 1
              for (maskIndex in mask.indices) {
                if (mask[maskIndex]) {
                  accumulator.maskTotals[maskIndex] += 1
                }
                if (edgeMask[maskIndex]) {
                  accumulator.edgeMaskTotals[maskIndex] += 1
                }
                accumulator.grayTotals[maskIndex] += gray[maskIndex].toDouble()
              }
              for (rowIndex in rows.indices) {
                accumulator.rowTotals[rowIndex] += rows[rowIndex]
                accumulator.edgeRowTotals[rowIndex] += edgeRows[rowIndex]
              }
              for (columnIndex in columns.indices) {
                accumulator.columnTotals[columnIndex] += columns[columnIndex]
                accumulator.edgeColumnTotals[columnIndex] += edgeColumns[columnIndex]
              }
              for (featureIndex in featureProfile.indices) {
                accumulator.featureTotals[featureIndex] += featureProfile[featureIndex]
              }
              bitmap.recycle()
            }
          } catch (_: Exception) {
          }
        }

        accumulators.values.forEach { accumulator ->
          if (accumulator.sampleCount <= 0) return@forEach
          val averagedMask = BooleanArray(accumulator.maskTotals.size)
          val averagedEdgeMask = BooleanArray(accumulator.edgeMaskTotals.size)
          val averagedGray = IntArray(accumulator.grayTotals.size)
          val averagedRows = DoubleArray(accumulator.rowTotals.size)
          val averagedColumns = DoubleArray(accumulator.columnTotals.size)
          val averagedEdgeRows = DoubleArray(accumulator.edgeRowTotals.size)
          val averagedEdgeColumns = DoubleArray(accumulator.edgeColumnTotals.size)
          val averagedFeatures = DoubleArray(accumulator.featureTotals.size)

          for (maskIndex in accumulator.maskTotals.indices) {
            val ratio = accumulator.maskTotals[maskIndex].toDouble() / accumulator.sampleCount.toDouble()
            averagedMask[maskIndex] = ratio >= 0.42
            val edgeRatio = accumulator.edgeMaskTotals[maskIndex].toDouble() / accumulator.sampleCount.toDouble()
            averagedEdgeMask[maskIndex] = edgeRatio >= 0.34
            averagedGray[maskIndex] = (accumulator.grayTotals[maskIndex] / accumulator.sampleCount.toDouble()).toInt()
          }
          for (rowIndex in accumulator.rowTotals.indices) {
            averagedRows[rowIndex] = accumulator.rowTotals[rowIndex] / accumulator.sampleCount.toDouble()
            averagedEdgeRows[rowIndex] = accumulator.edgeRowTotals[rowIndex] / accumulator.sampleCount.toDouble()
          }
          for (columnIndex in accumulator.columnTotals.indices) {
            averagedColumns[columnIndex] = accumulator.columnTotals[columnIndex] / accumulator.sampleCount.toDouble()
            averagedEdgeColumns[columnIndex] = accumulator.edgeColumnTotals[columnIndex] / accumulator.sampleCount.toDouble()
          }
          for (featureIndex in accumulator.featureTotals.indices) {
            averagedFeatures[featureIndex] = accumulator.featureTotals[featureIndex] / accumulator.sampleCount.toDouble()
          }

          templateVariants.getOrPut(accumulator.setName) { mutableListOf() }.add(
            SetTemplateVariant(
              source = "trained-${accumulator.profile}",
              profile = accumulator.profile,
              mask = averagedMask,
              edgeMask = averagedEdgeMask,
              gray = averagedGray,
              rowProfile = averagedRows,
              columnProfile = averagedColumns,
              edgeRowProfile = averagedEdgeRows,
              edgeColumnProfile = averagedEdgeColumns,
              featureProfile = averagedFeatures,
            )
          )
        }
      }
    } catch (_: Exception) {
    }
  }

  private fun loadLearnedSampleDescriptors(): List<LearnedSampleDescriptor> {
    return try {
      context.assets.open(LEARNED_SET_MANIFEST_ASSET_PATH).use { stream ->
        val manifest = JSONObject(stream.bufferedReader().use { it.readText() })
        val samples = manifest.optJSONArray("samples") ?: return emptyList()
        buildList {
          for (index in 0 until samples.length()) {
            val sample = samples.optJSONObject(index) ?: continue
            val setName = sample.optString("set")
            val profile = sample.optString("profile", "generic")
            val relativePath = sample.optString("relativePath")
            if (setName.isBlank() || relativePath.isBlank()) continue
            add(
              LearnedSampleDescriptor(
                setName = setName,
                profile = profile,
                assetPath = "$LEARNED_SET_ASSET_DIR/$relativePath",
              )
            )
          }
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun loadLearnedSetModels(): Map<String, LearnedProfileModel> {
    val samplesByProfile = linkedMapOf<String, MutableList<Pair<String, DoubleArray>>>()
    val trainingSamples = mutableListOf<LearnedTrainingSample>()
    loadLearnedSampleDescriptors().forEach { descriptor ->
      try {
        context.assets.open(descriptor.assetPath).use { stream ->
          val bitmap = BitmapFactory.decodeStream(stream) ?: return@use
          val mask = buildObservedSymbolMask(bitmap, descriptor.profile)
          val edgeMask = buildObservedSymbolEdgeMask(bitmap, descriptor.profile)
          val gray = buildObservedGrayscale(bitmap, setSymbolSize)
          val rows = rowProfile(mask, setSymbolSize)
          val columns = columnProfile(mask, setSymbolSize)
          val edgeRows = rowProfile(edgeMask, setSymbolSize)
          val edgeColumns = columnProfile(edgeMask, setSymbolSize)
          val featureProfile = symbolFeatureProfile(mask, edgeMask, setSymbolSize, descriptor.profile)
          val featureVector = buildModelFeatureVector(
            mask,
            edgeMask,
            gray,
            rows,
            columns,
            edgeRows,
            edgeColumns,
            featureProfile,
            setSymbolSize,
            descriptor.profile,
          )
          samplesByProfile.getOrPut(descriptor.profile) { mutableListOf() }
            .add(descriptor.setName to featureVector)
          trainingSamples += LearnedTrainingSample(
            setName = descriptor.setName,
            profile = descriptor.profile,
            assetPath = descriptor.assetPath,
            features = featureVector,
            primaryMask = mask.copyOf(),
            edgeMask = edgeMask.copyOf(),
            gray = gray.copyOf(),
          )
          bitmap.recycle()
        }
      } catch (_: Exception) {
      }
    }

    val trainedModels = samplesByProfile.mapNotNull { (profile, samples) ->
      trainProfileModel(profile, samples)?.let { profile to it }
    }.toMap()
    writeLearnedModelDebug(trainingSamples, trainedModels)
    val externalModels = loadExternalLearnedSetModels()
    if (externalModels.isEmpty()) {
      return trainedModels
    }
    return trainedModels.toMutableMap().apply {
      putAll(externalModels)
    }
  }

  private fun trainProfileModel(
    profile: String,
    samples: List<Pair<String, DoubleArray>>,
  ): LearnedProfileModel? {
    if (samples.isEmpty()) return null
    val labels = samples.map { it.first }.distinct().sorted()
    if (labels.size < 2) return null
    val featureCount = samples.first().second.size
    if (featureCount == 0) return null

    val mean = DoubleArray(featureCount)
    samples.forEach { (_, features) ->
      for (index in features.indices) {
        mean[index] += features[index]
      }
    }
    for (index in mean.indices) {
      mean[index] /= samples.size.toDouble()
    }

    val scale = DoubleArray(featureCount)
    samples.forEach { (_, features) ->
      for (index in features.indices) {
        val delta = features[index] - mean[index]
        scale[index] += delta * delta
      }
    }
    for (index in scale.indices) {
      val variance = scale[index] / samples.size.toDouble()
      scale[index] = max(0.05, sqrt(variance))
    }

    val normalizedSamples = samples.map { (label, features) ->
      label to DoubleArray(featureCount) { index ->
        (features[index] - mean[index]) / scale[index]
      }
    }
    val labelToIndex = labels.withIndex().associate { it.value to it.index }
    val classCounts = IntArray(labels.size)
    samples.forEach { (label, _) ->
      val classIndex = labelToIndex[label] ?: return@forEach
      classCounts[classIndex] += 1
    }
    val maxClassCount = classCounts.maxOrNull()?.toDouble()?.coerceAtLeast(1.0) ?: 1.0
    val classWeights = DoubleArray(labels.size) { classIndex ->
      maxClassCount / max(1, classCounts[classIndex]).toDouble()
    }
    val weights = Array(labels.size) { DoubleArray(featureCount) }
    val biases = DoubleArray(labels.size)
    val learningRate = if (profile == "arrow") 0.08 else 0.12
    val regularization = if (profile == "arrow") 0.0016 else 0.0010
    val epochs = if (profile == "arrow") 520 else 320

    repeat(epochs) {
      val weightGradients = Array(labels.size) { DoubleArray(featureCount) }
      val biasGradients = DoubleArray(labels.size)
      var totalExampleWeight = 0.0

      normalizedSamples.forEach { (label, features) ->
        val logits = DoubleArray(labels.size) { classIndex ->
          var total = biases[classIndex]
          val classWeights = weights[classIndex]
          for (featureIndex in features.indices) {
            total += classWeights[featureIndex] * features[featureIndex]
          }
          total
        }
        val maxLogit = logits.maxOrNull() ?: 0.0
        val probabilities = DoubleArray(labels.size)
        var probabilityTotal = 0.0
        for (classIndex in logits.indices) {
          val expValue = kotlin.math.exp(logits[classIndex] - maxLogit)
          probabilities[classIndex] = expValue
          probabilityTotal += expValue
        }
        if (probabilityTotal <= 0.0) return@forEach
        for (classIndex in probabilities.indices) {
          probabilities[classIndex] /= probabilityTotal
        }

        val targetIndex = labelToIndex[label] ?: return@forEach
        val exampleWeight = classWeights[targetIndex]
        totalExampleWeight += exampleWeight
        for (classIndex in labels.indices) {
          val error = (probabilities[classIndex] - if (classIndex == targetIndex) 1.0 else 0.0) * exampleWeight
          biasGradients[classIndex] += error
          for (featureIndex in features.indices) {
            weightGradients[classIndex][featureIndex] += error * features[featureIndex]
          }
        }
      }

      val sampleCount = totalExampleWeight.coerceAtLeast(1.0)
      for (classIndex in labels.indices) {
        biases[classIndex] -= learningRate * (biasGradients[classIndex] / sampleCount)
        for (featureIndex in 0 until featureCount) {
          val gradient =
            (weightGradients[classIndex][featureIndex] / sampleCount) +
              (weights[classIndex][featureIndex] * regularization)
          weights[classIndex][featureIndex] -= learningRate * gradient
        }
      }
    }

    return LearnedProfileModel(
      profile = profile,
      labels = labels,
      weights = weights,
      biases = biases,
      mean = mean,
      scale = scale,
    )
  }

  private fun loadExternalLearnedSetModels(): Map<String, LearnedProfileModel> {
    val modelFile = File(context.filesDir, EXTERNAL_SET_MODEL_FILENAME)
    if (!modelFile.exists()) return emptyMap()
    return try {
      val root = JSONObject(modelFile.readText())
      val profiles = root.optJSONArray("profiles") ?: return emptyMap()
      buildMap {
        for (index in 0 until profiles.length()) {
          val profileObject = profiles.optJSONObject(index) ?: continue
          val profile = profileObject.optString("profile")
          if (profile.isBlank()) continue
          val labels = profileObject.optJSONArray("labels")?.toStringList().orEmpty()
          val weightsArray = profileObject.optJSONArray("weights") ?: continue
          val biases = profileObject.optJSONArray("biases")?.toDoubleArray() ?: continue
          val mean = profileObject.optJSONArray("mean")?.toDoubleArray() ?: continue
          val scale = profileObject.optJSONArray("scale")?.toDoubleArray() ?: continue
          if (labels.isEmpty() || weightsArray.length() != labels.size || biases.size != labels.size) continue
          val weights = Array(labels.size) { classIndex ->
            weightsArray.optJSONArray(classIndex)?.toDoubleArray() ?: DoubleArray(mean.size)
          }
          put(
            profile,
            LearnedProfileModel(
              profile = profile,
              labels = labels,
              weights = weights,
              biases = biases,
              mean = mean,
              scale = scale,
            )
          )
        }
      }
    } catch (_: Exception) {
      emptyMap()
    }
  }

  private fun writeLearnedModelDebug(
    samples: List<LearnedTrainingSample>,
    models: Map<String, LearnedProfileModel>,
  ) {
    try {
      val debugDir = File(context.cacheDir, "overlay-debug").apply {
        if (!exists()) mkdirs()
      }
      val rasterDir = File(debugDir, LEARNED_SET_RASTER_DIRNAME).apply {
        if (!exists()) mkdirs()
      }
      val outputFile = File(debugDir, LEARNED_SET_DEBUG_FILENAME)
      val root = JSONObject()
      root.put("generatedAt", System.currentTimeMillis())
      root.put("externalModelPath", File(context.filesDir, EXTERNAL_SET_MODEL_FILENAME).absolutePath)
      root.put(
        "samples",
        JSONArray().apply {
          samples.forEach { sample ->
            put(
              JSONObject()
                .put("set", sample.setName)
                .put("profile", sample.profile)
                .put("assetPath", sample.assetPath)
                .put("features", JSONArray(sample.features.toList()))
            )
          }
        }
      )
      root.put(
        "models",
        JSONArray().apply {
          models.values.forEach { model ->
            put(
              JSONObject()
                .put("profile", model.profile)
                .put("labels", JSONArray(model.labels))
                .put("biases", JSONArray(model.biases.toList()))
                .put("mean", JSONArray(model.mean.toList()))
                .put("scale", JSONArray(model.scale.toList()))
                .put(
                  "weights",
                  JSONArray().apply {
                    model.weights.forEach { classWeights ->
                      put(JSONArray(classWeights.toList()))
                    }
                  }
                )
            )
          }
        }
      )
      outputFile.writeText(root.toString(2))
      samples
        .filter { it.profile == "arrow" }
        .forEach { sample ->
          val baseName = "${sample.profile}-${slugifyDebugName(sample.setName)}-${File(sample.assetPath).nameWithoutExtension}"
          writeDebugBitmap(File(rasterDir, "$baseName-mask.png"), maskToBitmap(sample.primaryMask, setSymbolSize))
          writeDebugBitmap(File(rasterDir, "$baseName-edge.png"), maskToBitmap(sample.edgeMask, setSymbolSize))
          writeDebugBitmap(File(rasterDir, "$baseName-gray.png"), grayToBitmap(sample.gray, setSymbolSize))
        }
    } catch (_: Exception) {
    }
  }

  private fun writeObservedRasterDebug(
    profile: String,
    primaryMask: BooleanArray,
    edgeMask: BooleanArray,
    gray: IntArray,
    debugText: String? = null,
  ) {
    try {
      val debugDir = File(context.cacheDir, "overlay-debug").apply {
        if (!exists()) mkdirs()
      }
      writeDebugBitmap(File(debugDir, "set-classifier-observed-mask.png"), maskToBitmap(primaryMask, setSymbolSize))
      writeDebugBitmap(File(debugDir, "set-classifier-observed-edge.png"), maskToBitmap(edgeMask, setSymbolSize))
      writeDebugBitmap(File(debugDir, "set-classifier-observed-gray.png"), grayToBitmap(gray, setSymbolSize))
      File(debugDir, "set-classifier-observed-profile.txt").writeText(profile)
      if (!debugText.isNullOrBlank()) {
        File(debugDir, "set-classifier-observed-debug.txt").writeText(
          buildString {
            append(debugText)
            val shapeDebugText = lastShapeDebugText
            if (!shapeDebugText.isNullOrBlank()) {
              if (!debugText.endsWith('\n')) appendLine()
              append(shapeDebugText)
            }
          }
        )
      }

      if (profile == "arrow") {
        writeDebugBitmap(File(debugDir, "set-classifier-arrow-observed-mask.png"), maskToBitmap(primaryMask, setSymbolSize))
        writeDebugBitmap(File(debugDir, "set-classifier-arrow-observed-edge.png"), maskToBitmap(edgeMask, setSymbolSize))
        writeDebugBitmap(File(debugDir, "set-classifier-arrow-observed-gray.png"), grayToBitmap(gray, setSymbolSize))
      }
    } catch (_: Exception) {
    }
  }

  private fun writeShapeObservedDebug(
    debugText: String?,
    observedRawGray: IntArray? = null,
    observedMask: BooleanArray? = null,
    observedOutlineMask: BooleanArray? = null,
    observedRoundSeedMask: BooleanArray? = null,
    observedRoundSmoothedMask: BooleanArray? = null,
    observedCircleBoundaryMask: BooleanArray? = null,
    observedContourOverlayBitmap: Bitmap? = null,
    syntheticCandidateDebugs: List<SyntheticCandidateDebug> = emptyList(),
  ) {
    if (debugText.isNullOrBlank()) return
    try {
      val externalRoot = context.getExternalFilesDir(null)
      val debugDir = (if (externalRoot != null) File(externalRoot, "overlay-debug")
                      else File(context.cacheDir, "overlay-debug")).apply {
        if (!exists()) mkdirs()
      }
      if (observedMask != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-mask.png"),
          maskToBitmap(observedMask, size),
        )
      }
      if (observedRawGray != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-crop.png"),
          grayToBitmap(observedRawGray, size),
        )
      }
      if (observedOutlineMask != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-outline.png"),
          maskToBitmap(observedOutlineMask, size),
        )
      }
      if (observedRoundSeedMask != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-round-seed.png"),
          maskToBitmap(observedRoundSeedMask, size),
        )
      }
      if (observedRoundSmoothedMask != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-round-smoothed.png"),
          maskToBitmap(observedRoundSmoothedMask, size),
        )
      }
      if (observedCircleBoundaryMask != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-circle-boundary.png"),
          maskToBitmap(observedCircleBoundaryMask, size),
        )
      }
      if (observedContourOverlayBitmap != null) {
        writeDebugBitmap(
          File(debugDir, "shape-classifier-observed-contour-overlay.png"),
          observedContourOverlayBitmap,
        )
      }
      syntheticCandidateDebugs.forEach { candidate ->
        val slug = slugifyDebugName(candidate.label)
        writeDebugBitmap(
          File(debugDir, "shape-classifier-candidate-$slug-mask.png"),
          maskToBitmap(candidate.mask, size),
        )
        writeDebugBitmap(
          File(debugDir, "shape-classifier-candidate-$slug-outline.png"),
          maskToBitmap(candidate.outlineMask, size),
        )
        if (candidate.contourOverlayBitmap != null) {
          writeDebugBitmap(
            File(debugDir, "shape-classifier-candidate-$slug-overlay.png"),
            candidate.contourOverlayBitmap,
          )
        }
      }
      File(debugDir, "shape-classifier-observed-debug.txt").writeText(
        buildString {
          appendLine("generatedAt=${System.currentTimeMillis()}")
          append(debugText)
        }
      )
    } catch (_: Exception) {
    }
  }

  private fun appendShapeSaveDebug(debugText: String) {
    if (debugText.isBlank()) return
    try {
      val debugDir = File(context.cacheDir, "overlay-debug").apply {
        if (!exists()) mkdirs()
      }
      File(debugDir, SHAPE_SAVE_DEBUG_FILENAME).appendText(
        buildString {
          appendLine("generatedAt=${System.currentTimeMillis()}")
          append(debugText.trim())
          appendLine()
          appendLine("---")
        }
      )
    } catch (_: Exception) {
    }
  }

  private fun recycleSyntheticCandidateDebugs(candidates: List<SyntheticCandidateDebug>) {
    candidates.forEach { candidate ->
      candidate.contourOverlayBitmap?.recycle()
    }
  }

  private fun createSetTemplateVariant(
    bitmap: Bitmap,
    source: String,
    profile: String,
  ): SetTemplateVariant {
    val primaryMask = if (source.startsWith("learned") || source.startsWith("trained") || source.startsWith("real")) {
      buildObservedSymbolMask(bitmap, profile)
    } else {
      buildSetTemplateMask(bitmap)
    }
    val edgeMask = if (source.startsWith("learned") || source.startsWith("trained") || source.startsWith("real")) {
      buildObservedSymbolEdgeMask(bitmap, profile)
    } else {
      buildSetTemplateMask(bitmap)
    }

    return SetTemplateVariant(
      source = source,
      profile = profile,
      mask = primaryMask,
      edgeMask = edgeMask,
      gray = buildObservedGrayscale(bitmap, setSymbolSize),
      rowProfile = rowProfile(primaryMask, setSymbolSize),
      columnProfile = columnProfile(primaryMask, setSymbolSize),
      edgeRowProfile = rowProfile(edgeMask, setSymbolSize),
      edgeColumnProfile = columnProfile(edgeMask, setSymbolSize),
      featureProfile = symbolFeatureProfile(primaryMask, edgeMask, setSymbolSize, profile),
    )
  }

  private fun buildTemplateMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val mask = BooleanArray(size * size)
    for (y in 0 until size) {
      for (x in 0 until size) {
        if (shouldMuteOuterShapeFillPixel(x, y, size)) {
          mask[y * size + x] = false
          continue
        }
        val color = scaled.getPixel(x, y)
        val alpha = Color.alpha(color)
        val luminance = luminance(color)
        mask[y * size + x] = alpha > 24 && luminance > 42
      }
    }
    scaled.recycle()
    return mask
  }

  private fun buildSetTemplateMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, setSymbolSize, setSymbolSize, true)
    val mask = BooleanArray(setSymbolSize * setSymbolSize)
    for (y in 0 until setSymbolSize) {
      for (x in 0 until setSymbolSize) {
        if (!isWithinSetBadgeWindow(x, y, setSymbolSize)) {
          mask[y * setSymbolSize + x] = false
          continue
        }
        val color = scaled.getPixel(x, y)
        val alpha = Color.alpha(color)
        val luminance = luminance(color)
        mask[y * setSymbolSize + x] = alpha > 20 && luminance > 35
      }
    }
    scaled.recycle()
    return isolateCentralSymbol(trimOuterMask(mask, setSymbolSize, 0.18f), setSymbolSize)
  }

  private fun buildObservedMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val mask = BooleanArray(size * size)
    for (y in 0 until size) {
      for (x in 0 until size) {
        if (shouldIgnoreOuterShapeFillPixel(x, y, size)) {
          mask[y * size + x] = false
          continue
        }
        val color = scaled.getPixel(x, y)
        val alpha = Color.alpha(color)
        val luminance = luminance(color)
        val saturation = saturation(color)
        val visibleMetal = saturation < 0.34f && luminance > 42
        val visibleGlow = saturation >= 0.08f && luminance > 40
        val brightOpaque = alpha > 20 && luminance > 34
        mask[y * size + x] = brightOpaque && (visibleMetal || visibleGlow)
      }
    }
    scaled.recycle()
    return mask
  }

  private fun buildObservedHsvShapeMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val mask = BooleanArray(size * size)
    val hsv = FloatArray(3)
    for (y in 0 until size) {
      for (x in 0 until size) {
        if (shouldIgnoreOuterShapeFillPixel(x, y, size)) {
          mask[y * size + x] = false
          continue
        }
        val color = scaled.getPixel(x, y)
        Color.colorToHSV(color, hsv)
        val alpha = Color.alpha(color)
        val saturation = hsv[1]
        val value = hsv[2]
        val broadMetallic = saturation <= 0.68f && value >= 0.18f
        val brightColored = saturation >= 0.10f && value >= 0.24f
        val vividAccent = saturation >= 0.24f && value >= 0.18f
        mask[y * size + x] = alpha > 18 && (broadMetallic || brightColored || vividAccent)
      }
    }
    scaled.recycle()
    return isolateOuterShape(closeMask(mask, size, 1), size)
  }

  private fun extractOpenCvOuterContour(bitmap: Bitmap): OpenCvContourResult? {
    if (!ensureOpenCvReady()) {
      return null
    }
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    var rgba: Mat? = null
    var hsv: Mat? = null
    var broadMask: Mat? = null
    var metallicMask: Mat? = null
    var combinedMask: Mat? = null
    var closedMask: Mat? = null
    var hierarchy: Mat? = null
    try {
      rgba = Mat()
      hsv = Mat()
      broadMask = Mat()
      metallicMask = Mat()
      combinedMask = Mat()
      closedMask = Mat()
      hierarchy = Mat()

      Utils.bitmapToMat(scaled, rgba)
      Imgproc.cvtColor(rgba, hsv, Imgproc.COLOR_RGBA2RGB)
      Imgproc.cvtColor(hsv, hsv, Imgproc.COLOR_RGB2HSV)

      Core.inRange(hsv, Scalar(0.0, 18.0, 38.0), Scalar(180.0, 255.0, 255.0), broadMask)
      Core.inRange(hsv, Scalar(0.0, 0.0, 52.0), Scalar(180.0, 86.0, 255.0), metallicMask)
      Core.bitwise_or(broadMask, metallicMask, combinedMask)

      val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(3.0, 3.0))
      Imgproc.morphologyEx(combinedMask, closedMask, Imgproc.MORPH_CLOSE, kernel)

      val contours = mutableListOf<MatOfPoint>()
      Imgproc.findContours(closedMask, contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
      if (contours.isEmpty()) return null

      val center = Point((size - 1) / 2.0, (size - 1) / 2.0)
      val maxArea = contours.maxOf { Imgproc.contourArea(it).coerceAtLeast(1.0) }
      val bestContour = contours.maxByOrNull { contour ->
        val area = Imgproc.contourArea(contour).coerceAtLeast(1.0)
        val moments = Imgproc.moments(contour)
        val centroid = if (kotlin.math.abs(moments.m00) > 1e-6) {
          Point(moments.m10 / moments.m00, moments.m01 / moments.m00)
        } else {
          val rect = Imgproc.boundingRect(contour)
          Point(rect.x + (rect.width / 2.0), rect.y + (rect.height / 2.0))
        }
        val distance = kotlin.math.hypot(centroid.x - center.x, centroid.y - center.y) / kotlin.math.hypot(center.x, center.y).coerceAtLeast(1.0)
        val rect = Imgproc.boundingRect(contour)
        val borderPenalty = if (rect.x <= 0 || rect.y <= 0 || rect.x + rect.width >= size - 1 || rect.y + rect.height >= size - 1) 0.12 else 0.0
        ((area / maxArea) * 0.78) + ((1.0 - distance).coerceIn(0.0, 1.0) * 0.22) - borderPenalty
      } ?: return null

      val maskMat = Mat.zeros(size, size, CvType.CV_8UC1)
      Imgproc.drawContours(maskMat, listOf(bestContour), -1, Scalar(255.0), Imgproc.FILLED)
      val mask = booleanArrayFromMat(maskMat, size)
      val normalizedMask = normalizeShapeMask(mask, size)
      val outlineMask = extractOutlineMask(normalizedMask, size)

      val contour2f = MatOfPoint2f(*bestContour.toArray())
      val perimeter = Imgproc.arcLength(contour2f, true).coerceAtLeast(1e-6)
      val epsilon = perimeter * 0.02
      val approx = MatOfPoint2f()
      Imgproc.approxPolyDP(contour2f, approx, epsilon, true)
      val rect = Imgproc.boundingRect(bestContour)
      val aspectRatio = max(rect.width, rect.height).toDouble() / max(1, minOf(rect.width, rect.height)).toDouble()
      val area = Imgproc.contourArea(bestContour).coerceAtLeast(1.0)
      val extent = (area / max(1, rect.width * rect.height).toDouble()).coerceIn(0.0, 1.0)
      val circularity = ((4.0 * kotlin.math.PI * area) / (perimeter * perimeter)).coerceIn(0.0, 1.0)

      return OpenCvContourResult(
        mask = normalizedMask,
        outlineMask = outlineMask,
        pointCloud = buildOuterShapePointCloud(normalizedMask, outlineMask, size),
        vertices = approx.toArray().size,
        aspectRatio = aspectRatio,
        extent = extent,
        circularity = circularity,
      )
    } catch (t: Throwable) {
      Log.e(TAG, "OpenCV contour extraction failed; falling back to legacy shape path", t)
      return null
    } finally {
      hierarchy?.release()
      closedMask?.release()
      combinedMask?.release()
      metallicMask?.release()
      broadMask?.release()
      hsv?.release()
      rgba?.release()
      scaled.recycle()
    }
  }

  private fun booleanArrayFromMat(maskMat: Mat, dimension: Int): BooleanArray {
    return booleanArrayFromMat(maskMat, dimension, dimension)
  }

  private fun booleanArrayFromMat(maskMat: Mat, width: Int, height: Int): BooleanArray {
    val data = ByteArray(width * height)
    maskMat.get(0, 0, data)
    return BooleanArray(width * height) { index -> (data.getOrElse(index) { 0 }.toInt() and 0xFF) > 0 }
  }

  private fun buildObservedEdgeMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val mask = BooleanArray(size * size)
    for (y in 1 until size - 1) {
      for (x in 1 until size - 1) {
        if (shouldIgnoreOuterShapeEdgePixel(x, y, size)) {
          mask[y * size + x] = false
          continue
        }
        val color = scaled.getPixel(x, y)
        val alpha = Color.alpha(color)
        val luma = luminance(color)
        val horizontalContrast = kotlin.math.abs(luma - luminance(scaled.getPixel(x + 1, y)))
        val verticalContrast = kotlin.math.abs(luma - luminance(scaled.getPixel(x, y + 1)))
        val saturation = saturation(color)
        val brightFrame = alpha > 20 && luma > 38 && saturation < 0.45f
        val sharpEdge = horizontalContrast > 14 || verticalContrast > 14
        mask[y * size + x] = brightFrame && sharpEdge
      }
    }
    scaled.recycle()
    return extractOutlineMask(mask, size)
  }

  private fun buildObservedRoundEdgeMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val mask = BooleanArray(size * size)
    val center = (size - 1) / 2.0
    val maxRadius = kotlin.math.hypot(center, center).coerceAtLeast(1.0)
    for (y in 1 until size - 1) {
      for (x in 1 until size - 1) {
        if (shouldIgnoreOuterShapeEdgePixel(x, y, size)) {
          mask[y * size + x] = false
          continue
        }
        val radialDistance = kotlin.math.hypot(x - center, y - center) / maxRadius
        if (radialDistance < 0.34 || radialDistance > 0.92) {
          mask[y * size + x] = false
          continue
        }
        val color = scaled.getPixel(x, y)
        val alpha = Color.alpha(color)
        val luma = luminance(color)
        val sat = saturation(color)
        val orthogonalContrast = localEdgeContrast(scaled, x, y, size)
        val diagonalContrast =
          max(
            kotlin.math.abs(luma - luminance(scaled.getPixel(x + 1, y + 1))),
            kotlin.math.abs(luma - luminance(scaled.getPixel(x - 1, y + 1))),
          )
        val brightBorder = alpha > 20 && luma > 26
        val metallicBorder = sat < 0.48f || luma > 56
        val edgeSignal = orthogonalContrast > 10 || diagonalContrast > 10
        mask[y * size + x] = brightBorder && metallicBorder && edgeSignal
      }
    }
    scaled.recycle()
    return keepOuterRoundEdgeComponents(keepOuterRingBand(mask, size), size)
  }

  private data class CenterPolarity(
    val inverted: Boolean,
    val centerLuma: Double,
    val centerSat: Double,
  )

  private fun sampleCenterPolarity(scaled: Bitmap): CenterPolarity {
    val size = setSymbolSize
    val x0 = (size * 0.30f).toInt()
    val x1 = (size * 0.70f).toInt()
    val y0 = (size * 0.30f).toInt()
    val y1 = (size * 0.70f).toInt()
    var lumaSum = 0.0
    var satSum = 0.0
    var count = 0
    for (y in y0 until y1) {
      for (x in x0 until x1) {
        val c = scaled.getPixel(x, y)
        lumaSum += luminance(c)
        satSum += saturation(c)
        count += 1
      }
    }
    if (count == 0) return CenterPolarity(false, 0.0, 0.0)
    val meanLuma = lumaSum / count
    val meanSat = satSum / count
    val inverted = meanSat > 0.25 && meanLuma in 55.0..135.0
    return CenterPolarity(inverted, meanLuma, meanSat)
  }

  private fun buildObservedSymbolMask(bitmap: Bitmap, profile: String = "generic"): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, setSymbolSize, setSymbolSize, true)
    val mask = BooleanArray(setSymbolSize * setSymbolSize)

    val lumaGrid = DoubleArray(setSymbolSize * setSymbolSize)
    val satGrid = FloatArray(setSymbolSize * setSymbolSize)
    val alphaGrid = IntArray(setSymbolSize * setSymbolSize)
    val inWindow = BooleanArray(setSymbolSize * setSymbolSize)
    val windowLumas = ArrayList<Double>(setSymbolSize * setSymbolSize)
    val windowSats = ArrayList<Float>(setSymbolSize * setSymbolSize)
    var centerSum = 0.0
    var centerCount = 0

    for (y in 0 until setSymbolSize) {
      for (x in 0 until setSymbolSize) {
        val idx = y * setSymbolSize + x
        val color = scaled.getPixel(x, y)
        val l = luminance(color).toDouble()
        lumaGrid[idx] = l
        satGrid[idx] = saturation(color)
        alphaGrid[idx] = Color.alpha(color)
        val within = isWithinSetBadgeWindow(x, y, setSymbolSize)
        inWindow[idx] = within
        if (within) {
          windowLumas.add(l)
          windowSats.add(satGrid[idx])
          if (centerWeight(x, y, setSymbolSize) > 0.55) {
            centerSum += l
            centerCount += 1
          }
        }
      }
    }

    if (windowLumas.isEmpty()) {
      scaled.recycle()
      return normalizeSetSymbolMask(mask, setSymbolSize, profile)
    }

    val sortedLuma = windowLumas.sorted()
    val median = sortedLuma[sortedLuma.size / 2]
    val madValues = ArrayList<Double>(sortedLuma.size)
    for (v in sortedLuma) madValues.add(kotlin.math.abs(v - median))
    madValues.sort()
    val mad = madValues[madValues.size / 2].coerceAtLeast(3.0)

    val sortedSat = windowSats.sorted()
    val satMedian = sortedSat[sortedSat.size / 2]

    val centerLuma = if (centerCount > 0) centerSum / centerCount else median
    val inverted = centerLuma < median - mad * 0.4

    val lumaDelta = (mad * 1.5).coerceIn(10.0, 40.0)
    val satDelta = (satMedian + 0.10f).coerceAtLeast(0.14f)

    for (y in 0 until setSymbolSize) {
      for (x in 0 until setSymbolSize) {
        val idx = y * setSymbolSize + x
        if (!inWindow[idx]) continue
        val cw = centerWeight(x, y, setSymbolSize)
        if (cw <= 0.16) continue
        if (alphaGrid[idx] <= 12) continue

        val l = lumaGrid[idx]
        val sat = satGrid[idx]
        val edge = localEdgeContrast(scaled, x, y, setSymbolSize)
        val deviation = l - median
        val marked = if (inverted) {
          val darkSymbol = deviation < -lumaDelta && l > 6
          val edgeSymbol = edge > 18 && deviation < -lumaDelta * 0.5
          darkSymbol || edgeSymbol
        } else {
          val brightSymbol = deviation > lumaDelta
          val saturatedSymbol = sat > satDelta && deviation > lumaDelta * 0.35
          val contrastSymbol = edge > 16 && deviation > lumaDelta * 0.25
          val darkEdgeSymbol = edge > 20 && kotlin.math.abs(deviation) > lumaDelta * 0.5
          brightSymbol || saturatedSymbol || contrastSymbol || darkEdgeSymbol
        }
        mask[idx] = marked
      }
    }
    scaled.recycle()
    return normalizeSetSymbolMask(mask, setSymbolSize, profile)
  }

  private fun buildObservedSymbolEdgeMask(bitmap: Bitmap, profile: String = "generic"): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, setSymbolSize, setSymbolSize, true)
    val mask = BooleanArray(setSymbolSize * setSymbolSize)

    val windowLumas = ArrayList<Double>(setSymbolSize * setSymbolSize)
    var centerSum = 0.0
    var centerCount = 0
    for (y in 0 until setSymbolSize) {
      for (x in 0 until setSymbolSize) {
        if (!isWithinSetBadgeWindow(x, y, setSymbolSize)) continue
        val l = luminance(scaled.getPixel(x, y)).toDouble()
        windowLumas.add(l)
        if (centerWeight(x, y, setSymbolSize) > 0.55) {
          centerSum += l
          centerCount += 1
        }
      }
    }
    if (windowLumas.isEmpty()) {
      scaled.recycle()
      return normalizeSetSymbolMask(mask, setSymbolSize, profile)
    }
    val sortedLuma = windowLumas.sorted()
    val median = sortedLuma[sortedLuma.size / 2]
    val madValues = ArrayList<Double>(sortedLuma.size)
    for (v in sortedLuma) madValues.add(kotlin.math.abs(v - median))
    madValues.sort()
    val mad = madValues[madValues.size / 2].coerceAtLeast(3.0)
    val centerLuma = if (centerCount > 0) centerSum / centerCount else median
    val inverted = centerLuma < median - mad * 0.4
    val lumaDelta = (mad * 1.5).coerceIn(10.0, 40.0)

    for (y in 1 until setSymbolSize - 1) {
      for (x in 1 until setSymbolSize - 1) {
        if (!isWithinSetBadgeWindow(x, y, setSymbolSize)) continue
        val color = scaled.getPixel(x, y)
        val luma = luminance(color).toDouble()
        val horizontalContrast = kotlin.math.abs(luma - luminance(scaled.getPixel(x + 1, y)).toDouble())
        val verticalContrast = kotlin.math.abs(luma - luminance(scaled.getPixel(x, y + 1)).toDouble())
        val saturation = saturation(color)
        val cw = centerWeight(x, y, setSymbolSize)
        if (cw <= 0.18) continue
        val deviation = luma - median
        val sharpEdge = horizontalContrast > 16 || verticalContrast > 16
        mask[y * setSymbolSize + x] = if (inverted) {
          val darkSymbol = deviation < -lumaDelta && luma > 6
          val edgeDark = sharpEdge && deviation < -lumaDelta * 0.5
          darkSymbol || edgeDark
        } else {
          val brightSymbol = deviation > lumaDelta
          val coloredSymbol = saturation > 0.12f && deviation > lumaDelta * 0.3
          val darkSharpEdge = (horizontalContrast > 20 || verticalContrast > 20) && kotlin.math.abs(deviation) > lumaDelta * 0.4
          (sharpEdge && (brightSymbol || coloredSymbol)) || darkSharpEdge
        }
      }
    }
    scaled.recycle()
    return normalizeSetSymbolMask(mask, setSymbolSize, profile)
  }

  private fun buildObservedGrayscale(bitmap: Bitmap, dimension: Int): IntArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, dimension, dimension, true)
    val gray = IntArray(dimension * dimension)
    var minGray = 255
    var maxGray = 0
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val value = if (
          !isWithinSetBadgeWindow(x, y, dimension)
        ) {
          0
        } else {
          (luminance(scaled.getPixel(x, y)) * setBadgeWeight(x, y, dimension)).toInt()
        }
        gray[y * dimension + x] = value
        if (value > 0) {
          if (value < minGray) minGray = value
          if (value > maxGray) maxGray = value
        }
      }
    }
    scaled.recycle()
    if (maxGray > minGray) {
      val range = (maxGray - minGray).toDouble().coerceAtLeast(1.0)
      for (index in gray.indices) {
        val value = gray[index]
        gray[index] = if (value <= 0) {
          0
        } else {
          (((value - minGray).coerceAtLeast(0) / range) * 255.0).toInt().coerceIn(0, 255)
        }
      }
    }
    return gray
  }

  private fun compareMasks(observed: BooleanArray, template: BooleanArray): Double {
    var intersection = 0
    var union = 0

    for (index in observed.indices) {
      val obs = observed[index]
      val tpl = template[index]
      if (obs && tpl) intersection += 1
      if (obs || tpl) union += 1
    }

    if (union == 0) return 0.0
    return intersection.toDouble() / max(1, union).toDouble()
  }

  private fun compareShapeMasks(observed: BooleanArray, template: BooleanArray, dimension: Int): Double {
    val iou = compareMasks(observed, template)
    val rowSimilarity = compareProfiles(rowProfile(observed, dimension), rowProfile(template, dimension))
    val colSimilarity = compareProfiles(columnProfile(observed, dimension), columnProfile(template, dimension))
    val occupancySimilarity = compareOccupancy(observed, template)
    val centroidSimilarity = compareCentroids(observed, template, dimension)
    val mainDiagonal = compareProfiles(mainDiagonalProfile(observed, dimension), mainDiagonalProfile(template, dimension))
    val antiDiagonal = compareProfiles(antiDiagonalProfile(observed, dimension), antiDiagonalProfile(template, dimension))
    return (iou * 0.30) + (rowSimilarity * 0.20) + (colSimilarity * 0.20) + (occupancySimilarity * 0.10) + (centroidSimilarity * 0.10) + (mainDiagonal * 0.05) + (antiDiagonal * 0.05)
  }

  private fun shapeGeometryBonus(shapeName: String, observed: BooleanArray, dimension: Int): Double {
    return when (shapeName) {
      "Arrow" -> arrowGeometryBonus(observed, dimension) + angularShapePenalty(observed, dimension, shapeName)
      "Triangle" -> triangleGeometryBonus(observed, dimension) + angularShapePenalty(observed, dimension, shapeName)
      "Diamond" -> diamondGeometryBonus(observed, dimension) + angularShapePenalty(observed, dimension, shapeName)
      "Circle" -> circleGeometryBonus(observed, dimension)
      "Cross" -> crossGeometryBonus(observed, dimension)
      "Square" -> squareGeometryBonus(observed, dimension)
      else -> 0.0
    }
  }

  private fun arrowGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val midY = (dimension * 0.50f).toInt()
    val upperY = (dimension * 0.34f).toInt()
    val lowerY = (dimension * 0.66f).toInt()
    val leftMid = rowFirstActive(mask, dimension, midY)
    val leftUpper = rowFirstActive(mask, dimension, upperY)
    val leftLower = rowFirstActive(mask, dimension, lowerY)
    if (leftMid == -1 || leftUpper == -1 || leftLower == -1) return 0.0

    val notchDepth = ((leftUpper + leftLower) / 2.0) - leftMid.toDouble()
    val rightReach = rowLastActive(mask, dimension, midY)
    val horizontalSpan = if (rightReach != -1) rightReach - leftMid else 0

    var bonus = 0.0
    if (notchDepth >= dimension * 0.07f) bonus += 0.050
    if (horizontalSpan >= dimension * 0.45f) bonus += 0.018
    if (notchDepth >= dimension * 0.10f && horizontalSpan >= dimension * 0.48f) bonus += 0.028
    val upperSpan = rowLastActive(mask, dimension, upperY) - leftUpper
    val lowerSpan = rowLastActive(mask, dimension, lowerY) - leftLower
    if (upperSpan > 0 && lowerSpan > 0) {
      val taperSymmetry = 1.0 - (kotlin.math.abs(upperSpan - lowerSpan).toDouble() / max(1, horizontalSpan).toDouble())
      if (taperSymmetry >= 0.76) bonus += 0.018
    }
    val asymmetry = arrowLikeAsymmetry(mask, dimension)
    if (asymmetry >= 0.10) bonus += 0.020
    if (asymmetry >= 0.16) bonus += 0.030
    if (asymmetry >= 0.22) bonus += 0.030
    val leftHalf = regionDensity(mask, dimension, 0, dimension / 2, 0, dimension)
    val rightHalf = regionDensity(mask, dimension, dimension / 2, dimension, 0, dimension)
    if (leftHalf > rightHalf * 1.08) {
      bonus += 0.018
    }
    val radial = radialBalance(mask, dimension)
    val cornerDensity = averageCornerDensity(mask, dimension)
    val middleCol = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val middleRow = rowActiveCount(mask, dimension, midY).toDouble() / max(1, dimension).toDouble()
    if (radial >= 0.86 && cornerDensity <= 0.10 && middleRow >= 0.42 && middleCol >= 0.42) {
      bonus -= 0.065
    }
    if (radial >= 0.90 && asymmetry < 0.14) {
      bonus -= 0.040
    }
    if (radial >= 0.84 && cornerDensity <= 0.08 && asymmetry < 0.12) {
      bonus -= 0.050
    }
    if (middleRow >= 0.48 && middleCol >= 0.48 && asymmetry < 0.12) {
      bonus -= 0.030
    }
    return bonus
  }

  private fun triangleGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val topY = (dimension * 0.18f).toInt()
    val midY = (dimension * 0.52f).toInt()
    val bottomY = (dimension * 0.82f).toInt()
    val topWidth = rowActiveCount(mask, dimension, topY)
    val midWidth = rowActiveCount(mask, dimension, midY)
    val bottomWidth = rowActiveCount(mask, dimension, bottomY)

    var bonus = 0.0
    if (topWidth in 1..(dimension / 7) && midWidth > topWidth * 2) bonus += 0.020
    if (bottomWidth > midWidth * 0.80) bonus += 0.008
    return bonus
  }

  private fun diamondGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val topY = (dimension * 0.20f).toInt()
    val midY = (dimension * 0.50f).toInt()
    val bottomY = (dimension * 0.80f).toInt()
    val topWidth = rowActiveCount(mask, dimension, topY)
    val midWidth = rowActiveCount(mask, dimension, midY)
    val bottomWidth = rowActiveCount(mask, dimension, bottomY)

    val topLeft = rowFirstActive(mask, dimension, topY)
    val topRight = rowLastActive(mask, dimension, topY)
    val bottomLeft = rowFirstActive(mask, dimension, bottomY)
    val bottomRight = rowLastActive(mask, dimension, bottomY)
    val leftX = (dimension * 0.20f).toInt()
    val rightX = (dimension * 0.80f).toInt()
    val leftHeight = columnActiveCount(mask, dimension, leftX)
    val rightHeight = columnActiveCount(mask, dimension, rightX)
    val mainDiagonal = mainDiagonalProfile(mask, dimension).average()
    val antiDiagonal = antiDiagonalProfile(mask, dimension).average()

    var bonus = 0.0
    if (midWidth > topWidth && midWidth > bottomWidth) bonus += 0.022
    if (topWidth in 1..(dimension / 5) && bottomWidth in 1..(dimension / 5)) bonus += 0.020
    if (midWidth >= max(1, topWidth) * 2 && midWidth >= max(1, bottomWidth) * 2) bonus += 0.024
    if (leftHeight in 1..(dimension / 4) && rightHeight in 1..(dimension / 4)) bonus += 0.016
    if (mainDiagonal >= 0.16 && antiDiagonal >= 0.16) bonus += 0.022

    if (topLeft != -1 && topRight != -1 && bottomLeft != -1 && bottomRight != -1) {
      val topCenter = (topLeft + topRight) / 2.0
      val bottomCenter = (bottomLeft + bottomRight) / 2.0
      val centerOffset = kotlin.math.abs(topCenter - bottomCenter)
      if (centerOffset <= dimension * 0.06f) bonus += 0.016
    }

    return bonus
  }

  private fun circleGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val midY = (dimension * 0.50f).toInt()
    val upperY = (dimension * 0.28f).toInt()
    val lowerY = (dimension * 0.72f).toInt()
    val midWidth = rowActiveCount(mask, dimension, midY)
    val upperWidth = rowActiveCount(mask, dimension, upperY)
    val lowerWidth = rowActiveCount(mask, dimension, lowerY)
    val leftX = (dimension * 0.28f).toInt()
    val rightX = (dimension * 0.72f).toInt()
    val leftHeight = columnActiveCount(mask, dimension, leftX)
    val rightHeight = columnActiveCount(mask, dimension, rightX)
    val cornerPenalty = averageCornerDensity(mask, dimension)
    val centerCol = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt())
    val mainDiagonal = mainDiagonalProfile(mask, dimension).average()
    val antiDiagonal = antiDiagonalProfile(mask, dimension).average()
    val radial = radialBalance(mask, dimension)

    var bonus = 0.0
    if (upperWidth > 0 && lowerWidth > 0) {
      val symmetry = 1.0 - (kotlin.math.abs(upperWidth - lowerWidth).toDouble() / max(1, dimension).toDouble())
      if (symmetry >= 0.88 && midWidth > upperWidth) bonus += 0.050
    }
    if (leftHeight > 0 && rightHeight > 0 && kotlin.math.abs(leftHeight - rightHeight) <= dimension * 0.10f) bonus += 0.025
    if (midWidth > 0 && kotlin.math.abs(midWidth - ((upperWidth + lowerWidth) / 2.0)) <= dimension * 0.12f) bonus += 0.018
    if (cornerPenalty <= 0.12) bonus += 0.025
    if (radial >= 0.84) bonus += 0.020
    if (radial >= 0.90) bonus += 0.018
    if (arrowLikeAsymmetry(mask, dimension) >= 0.10) bonus -= 0.040
    if (arrowLikeAsymmetry(mask, dimension) >= 0.16) bonus -= 0.042
    if (midWidth >= max(1, upperWidth) * 1.6 && midWidth >= max(1, lowerWidth) * 1.6) bonus -= 0.035
    if (centerCol >= max(1, leftHeight) * 1.6 && centerCol >= max(1, rightHeight) * 1.6) bonus -= 0.035
    if (midWidth >= max(1, upperWidth) * 2 || midWidth >= max(1, lowerWidth) * 2) bonus -= 0.050
    if (centerCol >= max(1, leftHeight) * 2 || centerCol >= max(1, rightHeight) * 2) bonus -= 0.045
    if (upperWidth <= dimension * 0.10f || lowerWidth <= dimension * 0.10f) bonus -= 0.040
    if (mainDiagonal >= 0.17 && antiDiagonal >= 0.17 && cornerPenalty <= 0.10) bonus -= 0.028
    return bonus
  }

  private fun crossGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val centerBand = bandActiveCount(mask, dimension, 0.40f, 0.60f, true)
    val verticalBand = bandActiveCount(mask, dimension, 0.40f, 0.60f, false)
    val cornerPenalty = averageCornerDensity(mask, dimension)
    val middleRow = rowActiveCount(mask, dimension, (dimension * 0.50f).toInt())
    val middleCol = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt())
    val upperRow = rowActiveCount(mask, dimension, (dimension * 0.28f).toInt())
    val lowerRow = rowActiveCount(mask, dimension, (dimension * 0.72f).toInt())
    val leftCol = columnActiveCount(mask, dimension, (dimension * 0.28f).toInt())
    val rightCol = columnActiveCount(mask, dimension, (dimension * 0.72f).toInt())
    val radial = radialBalance(mask, dimension)
    var bonus = 0.0
    if (centerBand > dimension * 8 && verticalBand > dimension * 8) bonus += 0.055
    if (kotlin.math.abs(centerBand - verticalBand) <= dimension * 6) bonus += 0.025
    if (cornerPenalty <= 0.08) bonus += 0.030
    if (middleRow >= dimension * 0.32f && middleCol >= dimension * 0.32f) bonus += 0.020
    if (middleRow >= max(1, upperRow) * 1.6 && middleRow >= max(1, lowerRow) * 1.6) bonus += 0.022
    if (middleCol >= max(1, leftCol) * 1.6 && middleCol >= max(1, rightCol) * 1.6) bonus += 0.022
    if (middleRow >= max(1, upperRow) * 2 && middleRow >= max(1, lowerRow) * 2) bonus += 0.040
    if (middleCol >= max(1, leftCol) * 2 && middleCol >= max(1, rightCol) * 2) bonus += 0.040
    if (
      radial >= 0.90 &&
      middleRow >= max(1, upperRow) * 1.6 &&
      middleCol >= max(1, leftCol) * 1.6
    ) {
      bonus += 0.020
    }
    if (radial >= 0.88) bonus -= 0.040
    if (arrowLikeAsymmetry(mask, dimension) >= 0.10) bonus -= 0.040
    if (arrowLikeAsymmetry(mask, dimension) >= 0.16) bonus -= 0.038
    return bonus
  }

  private fun squareGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val topY = (dimension * 0.18f).toInt()
    val bottomY = (dimension * 0.82f).toInt()
    val leftX = (dimension * 0.18f).toInt()
    val rightX = (dimension * 0.82f).toInt()
    val topWidth = rowActiveCount(mask, dimension, topY)
    val bottomWidth = rowActiveCount(mask, dimension, bottomY)
    val leftHeight = columnActiveCount(mask, dimension, leftX)
    val rightHeight = columnActiveCount(mask, dimension, rightX)
    val midWidth = rowActiveCount(mask, dimension, (dimension * 0.50f).toInt())
    val midHeight = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt())
    val cornerDensity = averageCornerDensity(mask, dimension)
    var bonus = 0.0
    if (topWidth >= dimension * 0.38f && bottomWidth >= dimension * 0.38f) bonus += 0.040
    if (leftHeight >= dimension * 0.38f && rightHeight >= dimension * 0.38f) bonus += 0.030
    if (kotlin.math.abs(topWidth - bottomWidth) <= dimension * 0.10f) bonus += 0.015
    if (kotlin.math.abs(leftHeight - rightHeight) <= dimension * 0.10f) bonus += 0.015
    if (midWidth >= dimension * 0.48f && midHeight >= dimension * 0.48f) bonus += 0.015
    if (cornerDensity >= 0.10) bonus += 0.020
    return bonus
  }

  private fun angularShapePenalty(mask: BooleanArray, dimension: Int, shapeName: String): Double {
    val radial = radialBalance(mask, dimension)
    val cornerDensity = averageCornerDensity(mask, dimension)
    val middleRow = rowActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val middleCol = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()

    var penalty = 0.0
    if (shapeName == "Diamond" || shapeName == "Triangle") {
      if (radial >= 0.82) penalty -= 0.020
      if (middleRow >= 0.42 && middleCol >= 0.42) penalty -= 0.010
    }
    if (shapeName == "Arrow") {
      if (middleRow >= 0.34 && middleCol >= 0.34) penalty -= 0.015
      if (cornerDensity <= 0.10) penalty -= 0.010
    }
    return penalty
  }

  private fun shapeConflictAdjustment(
    shapeName: String,
    observedMask: BooleanArray,
    observedOutlineMask: BooleanArray,
    dimension: Int,
  ): Double {
    val radial = radialBalance(observedMask, dimension)
    val asymmetry = arrowLikeAsymmetry(observedMask, dimension)
    val cornerDensity = averageCornerDensity(observedMask, dimension)
    val middleY = (dimension * 0.50f).toInt()
    val upperY = (dimension * 0.28f).toInt()
    val lowerY = (dimension * 0.72f).toInt()
    val middleX = (dimension * 0.50f).toInt()
    val leftX = (dimension * 0.28f).toInt()
    val rightX = (dimension * 0.72f).toInt()
    val middleRow = rowActiveCount(observedMask, dimension, middleY).toDouble() / max(1, dimension).toDouble()
    val upperRow = rowActiveCount(observedMask, dimension, upperY).toDouble() / max(1, dimension).toDouble()
    val lowerRow = rowActiveCount(observedMask, dimension, lowerY).toDouble() / max(1, dimension).toDouble()
    val middleCol = columnActiveCount(observedMask, dimension, middleX).toDouble() / max(1, dimension).toDouble()
    val leftCol = columnActiveCount(observedMask, dimension, leftX).toDouble() / max(1, dimension).toDouble()
    val rightCol = columnActiveCount(observedMask, dimension, rightX).toDouble() / max(1, dimension).toDouble()
    val outlineUpperRow = rowActiveCount(observedOutlineMask, dimension, upperY).toDouble() / max(1, dimension).toDouble()
    val outlineMiddleRow = rowActiveCount(observedOutlineMask, dimension, middleY).toDouble() / max(1, dimension).toDouble()
    val outlineLowerRow = rowActiveCount(observedOutlineMask, dimension, lowerY).toDouble() / max(1, dimension).toDouble()
    val outlineLeftCol = columnActiveCount(observedOutlineMask, dimension, leftX).toDouble() / max(1, dimension).toDouble()
    val outlineMiddleCol = columnActiveCount(observedOutlineMask, dimension, middleX).toDouble() / max(1, dimension).toDouble()
    val outlineRightCol = columnActiveCount(observedOutlineMask, dimension, rightX).toDouble() / max(1, dimension).toDouble()
    val triangleEvidence = triangleGeometryBonus(observedMask, dimension)
    val diamondEvidence = diamondGeometryBonus(observedMask, dimension)
    val diagonalEvidence =
      (mainDiagonalProfile(observedMask, dimension).average() + antiDiagonalProfile(observedMask, dimension).average()) / 2.0
    val outlineDiagonalEvidence =
      (mainDiagonalProfile(observedOutlineMask, dimension).average() + antiDiagonalProfile(observedOutlineMask, dimension).average()) / 2.0
    val outlineApexEvidence =
      ((outlineLowerRow - outlineUpperRow) * 0.70) +
        ((1.0 - outlineUpperRow).coerceIn(0.0, 1.0) * 0.20) +
        ((1.0 - kotlin.math.abs(outlineLeftCol - outlineRightCol)) * 0.10)
    val outlineDiamondEvidence =
      (outlineDiagonalEvidence * 0.70) +
        ((1.0 - outlineUpperRow).coerceIn(0.0, 1.0) * 0.10) +
        ((1.0 - outlineLowerRow).coerceIn(0.0, 1.0) * 0.10) +
        ((1.0 - outlineLeftCol).coerceIn(0.0, 1.0) * 0.05) +
        ((1.0 - outlineRightCol).coerceIn(0.0, 1.0) * 0.05)
    val thinOuterEdges =
      outlineUpperRow <= 0.12 &&
        outlineLowerRow <= 0.12 &&
        outlineLeftCol <= 0.12 &&
        outlineRightCol <= 0.12
    val strongTriangleApex =
      outlineUpperRow <= 0.08 &&
        outlineLowerRow >= 0.18 &&
        outlineLeftCol >= 0.10 &&
        outlineRightCol >= 0.10
    val crossDominance =
      ((middleRow - ((upperRow + lowerRow) / 2.0)) * 0.5) +
        ((middleCol - ((leftCol + rightCol) / 2.0)) * 0.5)
    val outlineCenterRowTransitions = normalizedTransitions(
      rowTransitions(observedOutlineMask, dimension, middleY),
      dimension,
    )
    val outlineCenterColTransitions = normalizedTransitions(
      columnTransitions(observedOutlineMask, dimension, middleX),
      dimension,
    )
    val outlineCrossEvidence = (outlineCenterRowTransitions + outlineCenterColTransitions) / 2.0
    val circleBalance =
      (1.0 - kotlin.math.abs(upperRow - lowerRow)) *
        (1.0 - kotlin.math.abs(leftCol - rightCol))
    val circleEvidence =
      (radial * 0.58) +
        (circleBalance * 0.42) -
        (crossDominance * 0.82) -
        (outlineCrossEvidence * 0.30) -
        (asymmetry * 0.18)
    val crossEvidence =
      (crossDominance * 1.28) +
        (outlineCrossEvidence * 0.82) +
        ((1.0 - cornerDensity) * 0.16) +
        (((middleRow + middleCol) / 2.0) * 0.10) -
        (circleBalance * 0.46)

    return when (shapeName) {
      "Arrow" -> {
        var adjustment = 0.0
        if (radial >= 0.84 && asymmetry < 0.12) adjustment -= 0.060
        if (radial >= 0.88 && cornerDensity <= 0.08) adjustment -= 0.035
        if (circleBalance >= 0.76 && middleRow >= 0.34 && middleCol >= 0.34) adjustment -= 0.030
        if (crossDominance >= 0.12) adjustment -= 0.024
        adjustment
      }
      "Circle" -> {
        var adjustment = 0.0
        if (radial >= 0.84 && asymmetry < 0.12) adjustment += 0.040
        if (circleBalance >= 0.76) adjustment += 0.022
        if (outlineCrossEvidence >= 0.18 && crossDominance >= 0.08) adjustment -= 0.040
        if (outlineCrossEvidence >= 0.22 && crossDominance >= 0.10) adjustment -= 0.055
        if (diamondEvidence >= 0.055 && diagonalEvidence >= 0.15) adjustment -= 0.055
        if (triangleEvidence >= 0.020 && upperRow <= 0.14 && lowerRow >= middleRow * 0.80) adjustment -= 0.030
        if (thinOuterEdges && outlineDiamondEvidence >= 0.22) adjustment -= 0.060
        if (strongTriangleApex && outlineApexEvidence >= 0.18) adjustment -= 0.045
        adjustment += ((circleEvidence - crossEvidence) * 0.22).coerceIn(-0.10, 0.10)
        adjustment
      }
      "Cross" -> {
        var adjustment = 0.0
        if (crossDominance >= 0.10) adjustment += 0.022
        if (crossDominance >= 0.14) adjustment += 0.018
        if (outlineCrossEvidence >= 0.18) adjustment += 0.050
        if (outlineCrossEvidence >= 0.22) adjustment += 0.060
        if (triangleEvidence >= 0.020 && upperRow <= 0.14 && lowerRow >= middleRow * 0.80) adjustment -= 0.075
        if (strongTriangleApex && outlineApexEvidence >= 0.18 && outlineMiddleCol < 0.26) adjustment -= 0.090
        adjustment += ((crossEvidence - circleEvidence) * 0.24).coerceIn(-0.10, 0.12)
        adjustment
      }
      "Triangle" -> {
        var adjustment = 0.0
        if (triangleEvidence >= 0.020) adjustment += 0.060
        if (upperRow <= 0.14 && lowerRow >= middleRow * 0.80) adjustment += 0.045
        if (crossDominance >= 0.10 && outlineCrossEvidence >= 0.16) adjustment -= 0.050
        if (circleBalance >= 0.76 && radial >= 0.84) adjustment -= 0.025
        if (outlineApexEvidence >= 0.16) adjustment += 0.085
        if (strongTriangleApex) adjustment += 0.060
        if (outlineCrossEvidence >= 0.18 && outlineMiddleRow >= outlineUpperRow * 1.8 && outlineMiddleCol >= outlineLeftCol * 1.5) adjustment -= 0.055
        adjustment
      }
      "Diamond" -> {
        var adjustment = 0.0
        if (diamondEvidence >= 0.050) adjustment += 0.055
        if (diagonalEvidence >= 0.16) adjustment += 0.035
        if (circleBalance >= 0.76 && radial >= 0.84) adjustment -= 0.040
        if (crossDominance >= 0.10 && outlineCrossEvidence >= 0.16) adjustment -= 0.020
        if (thinOuterEdges && outlineDiamondEvidence >= 0.22) adjustment += 0.090
        if (thinOuterEdges && outlineDiagonalEvidence >= 0.16) adjustment += 0.045
        if (!thinOuterEdges) adjustment -= 0.060
        if (outlineUpperRow >= 0.16 && outlineLowerRow >= 0.16 && outlineLeftCol >= 0.16 && outlineRightCol >= 0.16) adjustment -= 0.050
        adjustment
      }
      else -> 0.0
    }
  }

  private fun arrowLikeAsymmetry(mask: BooleanArray, dimension: Int): Double {
    val midY = (dimension * 0.50f).toInt()
    val upperY = (dimension * 0.34f).toInt()
    val lowerY = (dimension * 0.66f).toInt()
    val leftMid = rowFirstActive(mask, dimension, midY)
    val leftUpper = rowFirstActive(mask, dimension, upperY)
    val leftLower = rowFirstActive(mask, dimension, lowerY)
    val rightMid = rowLastActive(mask, dimension, midY)
    if (leftMid == -1 || leftUpper == -1 || leftLower == -1 || rightMid == -1) return 0.0

    val notchDepth = (((leftUpper + leftLower) / 2.0) - leftMid.toDouble()).coerceAtLeast(0.0)
    val span = (rightMid - leftMid).coerceAtLeast(0)
    if (span <= 0) return 0.0

    val normalizedNotch = (notchDepth / (dimension * 0.14)).coerceIn(0.0, 1.0)
    val normalizedSpan = (span.toDouble() / (dimension * 0.62)).coerceIn(0.0, 1.0)
    return (normalizedNotch * 0.68) + (normalizedSpan * 0.32)
  }

  private fun compareSetMasks(observed: BooleanArray, template: BooleanArray, dimension: Int): Double {
    val iou = compareMasks(observed, template)
    val rowSimilarity = compareProfiles(rowProfile(observed, dimension), rowProfile(template, dimension))
    val colSimilarity = compareProfiles(columnProfile(observed, dimension), columnProfile(template, dimension))
    val occupancySimilarity = compareOccupancy(observed, template)
    val centroidSimilarity = compareCentroids(observed, template, dimension)
    val mainDiagonal = compareProfiles(mainDiagonalProfile(observed, dimension), mainDiagonalProfile(template, dimension))
    val antiDiagonal = compareProfiles(antiDiagonalProfile(observed, dimension), antiDiagonalProfile(template, dimension))
    return (iou * 0.36) + (rowSimilarity * 0.14) + (colSimilarity * 0.14) + (occupancySimilarity * 0.12) + (centroidSimilarity * 0.10) + (mainDiagonal * 0.07) + (antiDiagonal * 0.07)
  }

  private fun scoreSetVariant(
    maskScore: Double,
    grayScore: Double,
    rowScore: Double,
    columnScore: Double,
    featureScore: Double,
    occupancyScore: Double,
    centroidScore: Double,
    source: String,
    profile: String,
  ): Double {
    return if (source.startsWith("trained")) {
      if (profile == "arrow") {
        (maskScore * 0.08) +
          (grayScore * 0.28) +
          (rowScore * 0.12) +
          (columnScore * 0.12) +
          (featureScore * 0.28) +
          (occupancyScore * 0.05) +
          (centroidScore * 0.05)
      } else {
        (maskScore * 0.23) +
          (grayScore * 0.12) +
          (rowScore * 0.17) +
          (columnScore * 0.17) +
          (featureScore * 0.16) +
          (occupancyScore * 0.08) +
          (centroidScore * 0.07)
      }
    } else if (source.startsWith("learned")) {
      if (profile == "arrow") {
        (maskScore * 0.10) +
          (grayScore * 0.26) +
          (rowScore * 0.12) +
          (columnScore * 0.12) +
          (featureScore * 0.28) +
          (occupancyScore * 0.06) +
          (centroidScore * 0.06)
      } else {
        (maskScore * 0.25) +
          (grayScore * 0.14) +
          (rowScore * 0.16) +
          (columnScore * 0.16) +
          (featureScore * 0.14) +
          (occupancyScore * 0.08) +
          (centroidScore * 0.07)
      }
    } else if (source.startsWith("real")) {
      if (profile == "arrow") {
        (maskScore * 0.18) + (grayScore * 0.34) + (featureScore * 0.18)
      } else {
        (maskScore * 0.52) + (grayScore * 0.24) + (featureScore * 0.12)
      }
    } else {
      (maskScore * 0.66) + (grayScore * 0.08) + (featureScore * 0.10)
    }
  }

  private fun setGeometryBonus(setName: String, mask: BooleanArray, dimension: Int): Double {
    return when (setName) {
      "Speed" -> speedSetGeometryBonus(mask, dimension)
      "Health" -> healthSetGeometryBonus(mask, dimension)
      "Offense" -> offenseSetGeometryBonus(mask, dimension)
      "Crit Dmg" -> critDamageSetGeometryBonus(mask, dimension)
      else -> 0.0
    }
  }

  private fun arrowSetFeatureBonus(
    setName: String,
    primaryMask: BooleanArray,
    edgeMask: BooleanArray,
    gray: IntArray,
    featureProfile: DoubleArray,
    dimension: Int,
  ): Double {
    val centerDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.38f).toInt(),
      (dimension * 0.62f).toInt(),
      (dimension * 0.34f).toInt(),
      (dimension * 0.66f).toInt(),
    )
    val topDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.24f).toInt(),
      (dimension * 0.76f).toInt(),
      (dimension * 0.18f).toInt(),
      (dimension * 0.38f).toInt(),
    )
    val bottomDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.24f).toInt(),
      (dimension * 0.76f).toInt(),
      (dimension * 0.60f).toInt(),
      (dimension * 0.82f).toInt(),
    )
    val leftDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.24f).toInt(),
      (dimension * 0.44f).toInt(),
      (dimension * 0.22f).toInt(),
      (dimension * 0.80f).toInt(),
    )
    val rightDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.56f).toInt(),
      (dimension * 0.76f).toInt(),
      (dimension * 0.22f).toInt(),
      (dimension * 0.80f).toInt(),
    )
    val upperRowTransitions = normalizedTransitions(rowTransitions(primaryMask, dimension, (dimension * 0.30f).toInt()), dimension)
    val centerRowTransitions = normalizedTransitions(rowTransitions(primaryMask, dimension, (dimension * 0.50f).toInt()), dimension)
    val centerColTransitions = normalizedTransitions(columnTransitions(primaryMask, dimension, (dimension * 0.50f).toInt()), dimension)
    val edgeCenterTransitions = normalizedTransitions(rowTransitions(edgeMask, dimension, (dimension * 0.50f).toInt()), dimension)
    val radial = radialBalance(primaryMask, dimension)
    val cornerDensity = averageCornerDensity(primaryMask, dimension)
    val verticalBand = columnActiveCount(primaryMask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val horizontalBand = rowActiveCount(primaryMask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val featurePeak = featureProfile.maxOrNull() ?: 0.0
    val grayCenter = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.38f).toInt(),
      (dimension * 0.62f).toInt(),
      (dimension * 0.30f).toInt(),
      (dimension * 0.72f).toInt(),
    )
    val grayUpperRight = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.56f).toInt(),
      (dimension * 0.82f).toInt(),
      (dimension * 0.12f).toInt(),
      (dimension * 0.34f).toInt(),
    )
    val grayLowerRight = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.56f).toInt(),
      (dimension * 0.82f).toInt(),
      (dimension * 0.48f).toInt(),
      (dimension * 0.76f).toInt(),
    )
    val grayMidRight = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.56f).toInt(),
      (dimension * 0.82f).toInt(),
      (dimension * 0.34f).toInt(),
      (dimension * 0.50f).toInt(),
    )
    val grayCenterColumn = grayColumnAverage(
      gray,
      dimension,
      (dimension * 0.50f).toInt(),
      (dimension * 0.20f).toInt(),
      (dimension * 0.78f).toInt(),
    )

    return when (setName) {
      "Crit Chance" -> {
        var bonus = 0.0
        if (upperRowTransitions >= 0.24) bonus += 0.048
        if (centerRowTransitions >= 0.30) bonus += 0.026
        if (centerColTransitions >= 0.22) bonus += 0.014
        if (topDensity > bottomDensity + 0.04) bonus += 0.034
        if (centerDensity in 0.10..0.24) bonus += 0.022
        if (radial < 0.88) bonus += 0.008
        if (grayUpperRight > grayCenter + 0.08) bonus += 0.050
        if (grayUpperRight > grayLowerRight + 0.08) bonus += 0.026
        if (grayUpperRight > grayCenterColumn + 0.03) bonus += 0.038
        if (grayCenterColumn > grayUpperRight + 0.03) bonus -= 0.060
        if (grayCenter > grayUpperRight + 0.05) bonus -= 0.030
        bonus
      }
      "Health" -> {
        var bonus = 0.0
        if (verticalBand >= 0.24 && horizontalBand >= 0.22) bonus += 0.040
        if (centerDensity >= 0.16) bonus += 0.024
        if (cornerDensity <= 0.10) bonus += 0.020
        if (kotlin.math.abs(leftDensity - rightDensity) <= 0.05) bonus += 0.018
        if (centerRowTransitions >= 0.18 && centerColTransitions >= 0.18) bonus += 0.016
        bonus
      }
      "Defense" -> {
        var bonus = 0.0
        if (radial >= 0.90) bonus += 0.016
        if (centerDensity >= 0.18) bonus += 0.010
        if (cornerDensity <= 0.08) bonus += 0.010
        if (centerRowTransitions <= 0.22 && centerColTransitions <= 0.20) bonus += 0.010
        if (topDensity >= bottomDensity + 0.03) bonus += 0.006
        bonus
      }
      "Tenacity" -> {
        var bonus = 0.0
        if (topDensity >= bottomDensity + 0.08) bonus += 0.020
        if (rightDensity >= leftDensity + 0.04) bonus += 0.014
        if (edgeCenterTransitions >= 0.18) bonus += 0.010
        if (radial in 0.78..0.90) bonus += 0.010
        if (featurePeak >= 0.70) bonus += 0.008
        if (grayCenterColumn > grayMidRight + 0.04) bonus += 0.020
        bonus
      }
      "Speed" -> {
        var bonus = 0.0
        if (rightDensity >= leftDensity + 0.06) bonus += 0.018
        if (centerRowTransitions >= 0.24) bonus += 0.012
        if (centerColTransitions <= 0.18) bonus += 0.010
        bonus
      }
      "Offense" -> {
        var bonus = 0.0
        if (grayCenter > grayUpperRight + 0.03) bonus += 0.082
        if (grayCenter > grayLowerRight + 0.02) bonus += 0.042
        if (grayCenter > grayMidRight + 0.02) bonus += 0.028
        if (grayCenter > grayCenterColumn + 0.02) bonus += 0.068
        if (centerDensity >= 0.14) bonus += 0.022
        if (radial in 0.76..0.90) bonus += 0.010
        if (grayUpperRight > grayCenter + 0.04) bonus -= 0.070
        if (grayCenterColumn > grayCenter + 0.03) bonus -= 0.095
        bonus
      }
      "Crit Dmg" -> {
        var bonus = 0.0
        if (centerColTransitions >= 0.22) bonus += 0.020
        if (topDensity > bottomDensity) bonus += 0.008
        if (centerDensity >= 0.14) bonus += 0.010
        if (grayCenterColumn > grayUpperRight + 0.03) bonus += 0.095
        if (grayCenterColumn > grayCenter + 0.015) bonus += 0.040
        if (grayLowerRight > grayMidRight + 0.03) bonus += 0.020
        if (grayUpperRight > grayCenterColumn + 0.02) bonus -= 0.125
        if (grayCenter > grayCenterColumn + 0.03) bonus -= 0.110
        bonus
      }
      else -> 0.0
    }
  }

  private fun arrowBurstTieBreakScore(
    setName: String,
    gray: IntArray,
    primaryMask: BooleanArray,
    dimension: Int,
  ): Double {
    if (!isArrowBurstSet(setName)) {
      return 0.0
    }

    val upperRight = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.56f).toInt(),
      (dimension * 0.84f).toInt(),
      (dimension * 0.10f).toInt(),
      (dimension * 0.34f).toInt(),
    )
    val center = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.38f).toInt(),
      (dimension * 0.64f).toInt(),
      (dimension * 0.28f).toInt(),
      (dimension * 0.72f).toInt(),
    )
    val centerColumn = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.46f).toInt(),
      (dimension * 0.56f).toInt(),
      (dimension * 0.18f).toInt(),
      (dimension * 0.80f).toInt(),
    )
    val lowerRight = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.58f).toInt(),
      (dimension * 0.84f).toInt(),
      (dimension * 0.48f).toInt(),
      (dimension * 0.80f).toInt(),
    )
    val centerDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.36f).toInt(),
      (dimension * 0.64f).toInt(),
      (dimension * 0.30f).toInt(),
      (dimension * 0.70f).toInt(),
    )
    val centerLeft = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.34f).toInt(),
      (dimension * 0.44f).toInt(),
      (dimension * 0.28f).toInt(),
      (dimension * 0.72f).toInt(),
    )
    val centerRight = grayRegionAverage(
      gray,
      dimension,
      (dimension * 0.58f).toInt(),
      (dimension * 0.68f).toInt(),
      (dimension * 0.28f).toInt(),
      (dimension * 0.72f).toInt(),
    )
    val surroundingCenter = (centerLeft + centerRight + center) / 3.0
    val strokeDominance = centerColumn - surroundingCenter
    val fillDominance = center - centerColumn
    val upperRightDominance = upperRight - maxOf(centerColumn, center)

    val chanceSignal =
      (upperRightDominance * 2.7) +
      ((upperRight - lowerRight) * 1.1) -
      (strokeDominance * 1.2) -
      (fillDominance * 0.6)
    val damageSignal =
      (strokeDominance * 3.1) +
      ((centerColumn - upperRight) * 1.3) +
      ((lowerRight - upperRight) * 0.5) -
      (fillDominance * 0.9)
    val offenseSignal =
      (fillDominance * 3.0) +
      ((center - upperRight) * 1.2) +
      (centerDensity * 0.35) -
      (strokeDominance * 1.1)

    return when (setName) {
      "Crit Chance" -> ((chanceSignal - maxOf(damageSignal, offenseSignal)) * 0.58).coerceIn(-0.30, 0.34)
      "Crit Dmg" -> ((damageSignal - maxOf(chanceSignal, offenseSignal)) * 0.58).coerceIn(-0.30, 0.34)
      "Offense" -> ((offenseSignal - maxOf(chanceSignal, damageSignal)) * 0.58).coerceIn(-0.30, 0.34)
      else -> 0.0
    }
  }

  private fun arrowBurstObservedPatchScore(
    setName: String,
    gray: IntArray,
    dimension: Int,
  ): Double {
    if (!isArrowBurstSet(setName)) return 0.0

    val patch = burstGrayPatch(gray, dimension)
    val upperRight = patch[3]
    val upperMidRight = patch[2]
    val centerMidLeft = patch[9]
    val centerMid = patch[10]
    val centerMidRight = patch[11]
    val lowerMid = patch[14]

    val chanceSignal =
      (upperRight * 2.4) +
      (upperMidRight * 1.0) -
      (centerMid * 1.3) -
      (centerMidRight * 0.9)
    val damageSignal =
      (centerMid * 2.2) +
      (lowerMid * 0.8) -
      (upperRight * 1.4) -
      (centerMidLeft * 0.6)
    val offenseSignal =
      ((centerMidLeft + centerMid + centerMidRight) * 0.95) -
      (upperRight * 1.0) -
      (lowerMid * 0.2)

    return when (setName) {
      "Crit Chance" -> ((chanceSignal - maxOf(damageSignal, offenseSignal)) * 0.34).coerceIn(-0.26, 0.30)
      "Crit Dmg" -> ((damageSignal - maxOf(chanceSignal, offenseSignal)) * 0.34).coerceIn(-0.26, 0.30)
      "Offense" -> ((offenseSignal - maxOf(chanceSignal, damageSignal)) * 0.34).coerceIn(-0.26, 0.30)
      else -> 0.0
    }
  }

  private data class ArrowBurstDecision(
    val patch: DoubleArray,
    val upperRightMark: Double,
    val centerStroke: Double,
    val centerFill: Double,
    val centerDensity: Double,
    val coolBlueBias: Double,
    val cyanBias: Double,
    val saturationLevel: Double,
    val scores: Map<String, Double>,
  ) {
    fun toDebugText(): String {
      return buildString {
        appendLine("arrow-burst")
        appendLine("upperRightMark=$upperRightMark")
        appendLine("centerStroke=$centerStroke")
        appendLine("centerFill=$centerFill")
        appendLine("centerDensity=$centerDensity")
        appendLine("coolBlueBias=$coolBlueBias")
        appendLine("cyanBias=$cyanBias")
        appendLine("saturationLevel=$saturationLevel")
        appendLine("patch=${patch.joinToString(",") { "%.4f".format(it) }}")
        scores.forEach { (name, score) ->
          appendLine("$name=$score")
        }
      }
    }
  }

  private fun arrowBurstDecision(
    bitmap: Bitmap,
    gray: IntArray,
    primaryMask: BooleanArray,
    dimension: Int,
  ): ArrowBurstDecision {
    val patch = burstGrayPatch(gray, dimension)
    val colorMetrics = burstColorMetrics(bitmap, dimension)
    val p0 = patch[0]
    val p1 = patch[1]
    val p2 = patch[2]
    val p3 = patch[3]
    val p4 = patch[4]
    val p5 = patch[5]
    val p6 = patch[6]
    val p7 = patch[7]
    val p8 = patch[8]
    val p9 = patch[9]
    val p10 = patch[10]
    val p11 = patch[11]
    val p12 = patch[12]
    val p13 = patch[13]
    val p14 = patch[14]
    val p15 = patch[15]

    val upperRightMark = (p3 * 1.4) + (p7 * 1.0) - (p6 * 0.5) - (p10 * 0.4)
    val centerStroke = (p6 * 1.0) + (p10 * 1.4) + (p11 * 0.8) + (p14 * 1.0) - (p3 * 0.5) - (p9 * 0.3)
    val centerFill =
      ((p5 + p6 + p10 + p11) * 0.72) +
        (p9 * 0.25) +
        ((p1 + p2 + p4 + p8) * 0.16) -
        (p3 * 0.6) -
        (p12 * 0.10) -
        (p14 * 0.10)
    val centerDensity = regionDensity(
      primaryMask,
      dimension,
      (dimension * 0.36f).toInt(),
      (dimension * 0.64f).toInt(),
      (dimension * 0.30f).toInt(),
      (dimension * 0.70f).toInt(),
    )
    val critChanceScore = arrowBurstTemplateScore(
      "Crit Chance",
      patch,
      upperRightMark,
      centerStroke,
      centerFill,
      centerDensity,
      colorMetrics,
    )
    val critDamageScore = arrowBurstTemplateScore(
      "Crit Dmg",
      patch,
      upperRightMark,
      centerStroke,
      centerFill,
      centerDensity,
      colorMetrics,
    )
    val offenseScore = arrowBurstTemplateScore(
      "Offense",
      patch,
      upperRightMark,
      centerStroke,
      centerFill,
      centerDensity,
      colorMetrics,
    )

    return ArrowBurstDecision(
      patch = patch,
      upperRightMark = upperRightMark,
      centerStroke = centerStroke,
      centerFill = centerFill,
      centerDensity = centerDensity,
      coolBlueBias = colorMetrics[0],
      cyanBias = colorMetrics[1],
      saturationLevel = colorMetrics[2],
      scores = mapOf(
        "Crit Chance" to critChanceScore,
        "Crit Dmg" to critDamageScore,
        "Offense" to offenseScore,
      ),
    )
  }

  private fun burstGrayPatch(gray: IntArray, dimension: Int): DoubleArray {
    val startX = (dimension * 0.34f).toInt()
    val endX = (dimension * 0.78f).toInt()
    val startY = (dimension * 0.14f).toInt()
    val endY = (dimension * 0.74f).toInt()
    val grid = 4
    val values = ArrayList<Double>(grid * grid)
    for (gridY in 0 until grid) {
      for (gridX in 0 until grid) {
        val cellStartX = startX + ((endX - startX) * gridX) / grid
        val cellEndX = startX + ((endX - startX) * (gridX + 1)) / grid
        val cellStartY = startY + ((endY - startY) * gridY) / grid
        val cellEndY = startY + ((endY - startY) * (gridY + 1)) / grid
        values += grayRegionAverage(
          gray,
          dimension,
          cellStartX,
          maxOf(cellStartX + 1, cellEndX),
          cellStartY,
          maxOf(cellStartY + 1, cellEndY),
        )
      }
    }
    return values.toDoubleArray()
  }

  private fun isArrowBurstSet(setName: String): Boolean {
    return setName == "Crit Chance" || setName == "Crit Dmg" || setName == "Offense"
  }

  private fun arrowBurstTemplateScore(
    setName: String,
    patch: DoubleArray,
    upperRightMark: Double,
    centerStroke: Double,
    centerFill: Double,
    centerDensity: Double,
    colorMetrics: DoubleArray,
  ): Double {
    val seedTemplate = ArrowBurstTemplate(
      patch = ARROW_BURST_PATCH_TEMPLATES.getValue(setName),
      metrics = ARROW_BURST_METRIC_TEMPLATES.getValue(setName),
    )
    val learnedPrototypes = learnedArrowBurstPrototypes(setName)
    val coolTintBias = ((colorMetrics[0] * 0.65) + (colorMetrics[1] * 0.35)) * colorMetrics[2]
    val seedScore = scoreArrowBurstAgainstTemplate(
      setName = setName,
      template = seedTemplate,
      patch = patch,
      upperRightMark = upperRightMark,
      centerStroke = centerStroke,
      centerFill = centerFill,
      centerDensity = centerDensity,
      colorMetrics = colorMetrics,
    )
    val baseScore = if (learnedPrototypes.isEmpty()) {
      seedScore
    } else {
      val maxPrototypeCount = learnedPrototypes.maxOf { it.sampleCount }.coerceAtLeast(1)
      val bestLearnedScore = learnedPrototypes.maxOf { prototype ->
        val supportBonus = (prototype.sampleCount.toDouble() / maxPrototypeCount.toDouble()) * 0.035
        val prototypeColorStrength = prototype.template.colorMetrics.sum()
        val legacyColorPenalty =
          if (prototypeColorStrength <= 0.015 && coolTintBias >= 0.025) {
            coolTintBias * 0.30
          } else {
            0.0
          }
        scoreArrowBurstAgainstTemplate(
          setName = setName,
          template = prototype.template,
          patch = patch,
          upperRightMark = upperRightMark,
          centerStroke = centerStroke,
          centerFill = centerFill,
          centerDensity = centerDensity,
          colorMetrics = colorMetrics,
        ) + supportBonus - legacyColorPenalty
      }
      val learnedBlend = if (coolTintBias >= 0.025) 0.68 else 0.80
      (bestLearnedScore * learnedBlend) + (seedScore * (1.0 - learnedBlend))
    }
    val lowerLeftMass = patch[8] + patch[12] + patch[13]
    val lowerMidMass = patch[9] + patch[10] + patch[14]
    val critDmgTemplatePatch = ARROW_BURST_PATCH_TEMPLATES.getValue("Crit Dmg")
    val offenseTemplatePatch = ARROW_BURST_PATCH_TEMPLATES.getValue("Offense")
    val critDmgRightBandSimilarity =
      1.0 - (
        kotlin.math.abs(patch[7] - critDmgTemplatePatch[7]) +
          kotlin.math.abs(patch[11] - critDmgTemplatePatch[11]) +
          (kotlin.math.abs(patch[13] - critDmgTemplatePatch[13]) * 2.0) +
          kotlin.math.abs(patch[15] - critDmgTemplatePatch[15])
        ) / 5.0
    val offenseRightBandSimilarity =
      1.0 - (
        kotlin.math.abs(patch[7] - offenseTemplatePatch[7]) +
          kotlin.math.abs(patch[11] - offenseTemplatePatch[11]) +
          (kotlin.math.abs(patch[13] - offenseTemplatePatch[13]) * 2.0) +
          kotlin.math.abs(patch[15] - offenseTemplatePatch[15])
        ) / 5.0
    val rightBandDelta = offenseRightBandSimilarity - critDmgRightBandSimilarity
    return when (setName) {
      "Offense" -> baseScore + ((lowerLeftMass - lowerMidMass) * 0.10) + (rightBandDelta * 0.55) - (coolTintBias * 0.05)
      "Crit Chance" -> baseScore + (((patch[9] + patch[12]) - (patch[13] + patch[14])) * 0.10) - (coolTintBias * 0.14)
      "Crit Dmg" -> baseScore - ((lowerLeftMass - lowerMidMass) * 0.08) - (rightBandDelta * 0.45) + (coolTintBias * 0.16)
      else -> baseScore
    }
  }

  private fun scoreArrowBurstAgainstTemplate(
    setName: String,
    template: ArrowBurstTemplate,
    patch: DoubleArray,
    upperRightMark: Double,
    centerStroke: Double,
    centerFill: Double,
    centerDensity: Double,
    colorMetrics: DoubleArray,
  ): Double {
    val patchSimilarity = compareProfiles(patch, template.patch)
    val metrics = template.metrics
    val weightedMetricDelta = when (setName) {
      "Crit Dmg" ->
        (kotlin.math.abs(upperRightMark - metrics[0]) * 1.0) +
          (kotlin.math.abs(centerStroke - metrics[1]) * 0.45) +
          (kotlin.math.abs(centerFill - metrics[2]) * 1.15) +
          (kotlin.math.abs(centerDensity - metrics[3]) * 1.0)
      else ->
        (kotlin.math.abs(upperRightMark - metrics[0]) * 1.0) +
          (kotlin.math.abs(centerStroke - metrics[1]) * 0.70) +
          (kotlin.math.abs(centerFill - metrics[2]) * 1.10) +
          (kotlin.math.abs(centerDensity - metrics[3]) * 1.0)
    }
    val metricSimilarity = (1.0 - (weightedMetricDelta / 4.0)).coerceIn(0.0, 1.0)
    val templateColorMetrics = template.colorMetrics
    val templateHasColorSignal = templateColorMetrics.sum() > 0.015
    val colorSimilarity =
      if (!templateHasColorSignal) {
        0.5
      } else {
        (
        1.0 - (
          (kotlin.math.abs(colorMetrics[0] - templateColorMetrics[0]) * 1.00) +
            (kotlin.math.abs(colorMetrics[1] - templateColorMetrics[1]) * 0.80) +
            (kotlin.math.abs(colorMetrics[2] - templateColorMetrics[2]) * 0.60)
          ) / 2.4
        ).coerceIn(0.0, 1.0)
      }
    return (patchSimilarity * 0.72) + (metricSimilarity * 0.10) + (colorSimilarity * 0.18)
  }

  private fun learnedArrowBurstPrototypes(setName: String): List<ArrowBurstLearnedPrototype> {
    val sampleFile = File(context.filesDir, ARROW_BURST_SAMPLE_FILENAME)
    val learnedSamples = loadArrowBurstSamples(sampleFile)[setName].orEmpty()
    if (learnedSamples.isEmpty()) return emptyList()

    return clusterArrowBurstSamples(learnedSamples)
      .sortedByDescending { it.sampleCount }
      .take(4)
  }

  private fun clusterArrowBurstSamples(
    samples: List<ArrowBurstObservation>,
  ): List<ArrowBurstLearnedPrototype> {
    if (samples.isEmpty()) return emptyList()
    data class MutableCluster(
      val members: MutableList<ArrowBurstObservation>,
    )

    val clusters = mutableListOf<MutableCluster>()
    samples.forEach { sample ->
      val closestCluster = clusters.minByOrNull { cluster ->
        arrowBurstObservationDistance(sample, averageArrowBurstObservation(cluster.members))
      }
      if (
        closestCluster != null &&
        arrowBurstObservationDistance(sample, averageArrowBurstObservation(closestCluster.members)) <= 0.055
      ) {
        closestCluster.members += sample
      } else {
        clusters += MutableCluster(mutableListOf(sample))
      }
    }

    return clusters.map { cluster ->
      val average = averageArrowBurstObservation(cluster.members)
      ArrowBurstLearnedPrototype(
        template = ArrowBurstTemplate(
          patch = average.patch,
          metrics = doubleArrayOf(
            average.upperRightMark,
            average.centerStroke,
            average.centerFill,
            average.centerDensity,
          ),
          colorMetrics = doubleArrayOf(
            average.coolBlueBias,
            average.cyanBias,
            average.saturationLevel,
          ),
        ),
        sampleCount = cluster.members.size,
      )
    }
  }

  private fun averageArrowBurstObservation(
    samples: List<ArrowBurstObservation>,
  ): ArrowBurstObservation {
    val patch = DoubleArray(16)
    samples.forEach { sample ->
      for (index in patch.indices) {
        patch[index] += sample.patch[index]
      }
    }
    for (index in patch.indices) {
      patch[index] /= samples.size.toDouble()
    }
    return ArrowBurstObservation(
      patch = patch,
      upperRightMark = samples.sumOf { it.upperRightMark } / samples.size.toDouble(),
      centerStroke = samples.sumOf { it.centerStroke } / samples.size.toDouble(),
      centerFill = samples.sumOf { it.centerFill } / samples.size.toDouble(),
      centerDensity = samples.sumOf { it.centerDensity } / samples.size.toDouble(),
      coolBlueBias = samples.sumOf { it.coolBlueBias } / samples.size.toDouble(),
      cyanBias = samples.sumOf { it.cyanBias } / samples.size.toDouble(),
      saturationLevel = samples.sumOf { it.saturationLevel } / samples.size.toDouble(),
    )
  }

  private fun arrowBurstObservationDistance(
    left: ArrowBurstObservation,
    right: ArrowBurstObservation,
  ): Double {
    val patchDistance = left.patch.indices.sumOf { index ->
      kotlin.math.abs(left.patch[index] - right.patch[index])
    } / left.patch.size.toDouble()
    val metricDistance =
      (kotlin.math.abs(left.upperRightMark - right.upperRightMark) * 0.90) +
        (kotlin.math.abs(left.centerStroke - right.centerStroke) * 0.55) +
        (kotlin.math.abs(left.centerFill - right.centerFill) * 0.70) +
        (kotlin.math.abs(left.centerDensity - right.centerDensity) * 0.45)
    val colorDistance =
      (kotlin.math.abs(left.coolBlueBias - right.coolBlueBias) * 0.60) +
        (kotlin.math.abs(left.cyanBias - right.cyanBias) * 0.45) +
        (kotlin.math.abs(left.saturationLevel - right.saturationLevel) * 0.35)
    return patchDistance + (metricDistance / 6.0) + (colorDistance / 5.0)
  }

  private fun burstColorMetrics(bitmap: Bitmap, dimension: Int): DoubleArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, dimension, dimension, true)
    val startX = (dimension * 0.34f).toInt()
    val endX = (dimension * 0.78f).toInt()
    val startY = (dimension * 0.14f).toInt()
    val endY = (dimension * 0.74f).toInt()
    var pixelCount = 0
    var coolBlueTotal = 0.0
    var cyanTotal = 0.0
    var saturationTotal = 0.0
    val hsv = FloatArray(3)
    for (y in startY until maxOf(startY + 1, endY)) {
      for (x in startX until maxOf(startX + 1, endX)) {
        val color = scaled.getPixel(x, y)
        val r = Color.red(color).toDouble() / 255.0
        val g = Color.green(color).toDouble() / 255.0
        val b = Color.blue(color).toDouble() / 255.0
        coolBlueTotal += ((b - r).coerceAtLeast(0.0) + ((b - g).coerceAtLeast(0.0) * 0.6))
        cyanTotal += ((b - r).coerceAtLeast(0.0) + (g * 0.35))
        Color.colorToHSV(color, hsv)
        saturationTotal += hsv[1].toDouble()
        pixelCount += 1
      }
    }
    scaled.recycle()
    if (pixelCount <= 0) return doubleArrayOf(0.0, 0.0, 0.0)
    return doubleArrayOf(
      (coolBlueTotal / pixelCount.toDouble()).coerceIn(0.0, 1.0),
      (cyanTotal / pixelCount.toDouble()).coerceIn(0.0, 1.0),
      (saturationTotal / pixelCount.toDouble()).coerceIn(0.0, 1.0),
    )
  }

  private fun parseArrowBurstObservation(debugText: String, patch: DoubleArray): ArrowBurstObservation? {
    val values = linkedMapOf<String, Double>()
    debugText.lineSequence().forEach { line ->
      val separator = line.indexOf('=')
      if (separator <= 0) return@forEach
      val key = line.substring(0, separator).trim()
      val value = line.substring(separator + 1).trim().toDoubleOrNull() ?: return@forEach
      values[key] = value
    }
    val upperRightMark = values["upperRightMark"] ?: return null
    val centerStroke = values["centerStroke"] ?: return null
    val centerFill = values["centerFill"] ?: return null
    val centerDensity = values["centerDensity"] ?: return null
    return ArrowBurstObservation(
      patch = patch.copyOf(),
      upperRightMark = upperRightMark,
      centerStroke = centerStroke,
      centerFill = centerFill,
      centerDensity = centerDensity,
      coolBlueBias = values["coolBlueBias"] ?: 0.0,
      cyanBias = values["cyanBias"] ?: 0.0,
      saturationLevel = values["saturationLevel"] ?: 0.0,
    )
  }

  private fun loadArrowBurstSamples(sampleFile: File): Map<String, MutableList<ArrowBurstObservation>> {
    if (!sampleFile.exists()) return emptyMap()
    return try {
      val root = JSONObject(sampleFile.readText())
      val samplesObject = root.optJSONObject("samples") ?: return emptyMap()
      buildMap {
        ARROW_BURST_SET_NAMES.forEach { setName ->
          val sampleArray = samplesObject.optJSONArray(setName) ?: return@forEach
          val parsed = mutableListOf<ArrowBurstObservation>()
          for (index in 0 until sampleArray.length()) {
            val sample = sampleArray.optJSONObject(index) ?: continue
            val patch = sample.optJSONArray("patch")?.toDoubleArray() ?: continue
            if (patch.size != 16) continue
            parsed += ArrowBurstObservation(
              patch = patch,
              upperRightMark = sample.optDouble("upperRightMark", 0.0),
              centerStroke = sample.optDouble("centerStroke", 0.0),
              centerFill = sample.optDouble("centerFill", 0.0),
              centerDensity = sample.optDouble("centerDensity", 0.0),
              coolBlueBias = sample.optDouble("coolBlueBias", 0.0),
              cyanBias = sample.optDouble("cyanBias", 0.0),
              saturationLevel = sample.optDouble("saturationLevel", 0.0),
            )
          }
          if (parsed.isNotEmpty()) {
            put(setName, parsed)
          }
        }
      }
    } catch (_: Exception) {
      emptyMap()
    }
  }

  private fun writeArrowBurstSamples(
    sampleFile: File,
    samplesBySet: Map<String, List<ArrowBurstObservation>>,
  ) {
    val root = JSONObject()
    val samplesObject = JSONObject()
    ARROW_BURST_SET_NAMES.forEach { setName ->
      val samples = samplesBySet[setName].orEmpty()
      val array = JSONArray()
      samples.forEach { sample ->
        array.put(
          JSONObject()
            .put("patch", JSONArray(sample.patch.toList()))
            .put("upperRightMark", sample.upperRightMark)
            .put("centerStroke", sample.centerStroke)
            .put("centerFill", sample.centerFill)
            .put("centerDensity", sample.centerDensity)
            .put("coolBlueBias", sample.coolBlueBias)
            .put("cyanBias", sample.cyanBias)
            .put("saturationLevel", sample.saturationLevel),
        )
      }
      samplesObject.put(setName, array)
    }
    root.put("samples", samplesObject)
    sampleFile.writeText(root.toString(2))
  }

  private fun loadShapeSamples(): Map<String, MutableList<ShapeObservation>> {
    val sampleDir = File(context.filesDir, SHAPE_SAMPLE_DIRNAME)
    if (sampleDir.exists() && sampleDir.isDirectory) {
      return buildMap {
        SHAPE_ASSET_NAMES.keys.forEach { shapeName ->
          val parsed = loadShapeSamplesForName(File(sampleDir, "$shapeName.json"))
          if (parsed.isNotEmpty()) {
            put(shapeName, parsed.toMutableList())
          }
        }
      }
    }

    return loadLegacyShapeSamples(File(context.filesDir, SHAPE_SAMPLE_FILENAME))
  }

  private fun loadLegacyShapeSamples(sampleFile: File): Map<String, MutableList<ShapeObservation>> {
    if (!sampleFile.exists()) return emptyMap()
    return try {
      val root = JSONObject(sampleFile.readText())
      val samplesObject = root.optJSONObject("samples") ?: return emptyMap()
      buildMap {
        SHAPE_ASSET_NAMES.keys.forEach { shapeName ->
          val sampleArray = samplesObject.optJSONArray(shapeName) ?: return@forEach
          val parsed = parseShapeSampleArray(sampleArray)
          if (parsed.isNotEmpty()) {
            put(shapeName, parsed.toMutableList())
          }
        }
      }
    } catch (_: Exception) {
      emptyMap()
    }
  }

  private fun loadShapeSamplesForName(sampleFile: File): List<ShapeObservation> {
    if (!sampleFile.exists()) return emptyList()
    return try {
      val root = JSONObject(sampleFile.readText())
      parseShapeSampleArray(root.optJSONArray("samples") ?: JSONArray())
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun parseShapeSampleArray(sampleArray: JSONArray): List<ShapeObservation> {
    val parsed = mutableListOf<ShapeObservation>()
    for (index in 0 until sampleArray.length()) {
      val sample = sampleArray.optJSONObject(index) ?: continue
      val maskBits = sample.optString("maskBits")
      val mask = bitStringToBooleanArray(maskBits, size * size) ?: continue
      val outlineMask = extractOutlineMask(mask, size)
      parsed += ShapeObservation(
        mask = mask,
        outlineMask = outlineMask,
        pointCloud = buildOuterShapePointCloud(mask, outlineMask, size),
        outerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = false),
        innerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = true),
        contourTurnProfile = buildContourTurnProfile(buildContourRadiusProfile(outlineMask, size, useNearest = false)),
        contourThicknessProfile = buildContourThicknessProfile(
          buildContourRadiusProfile(outlineMask, size, useNearest = false),
          buildContourRadiusProfile(outlineMask, size, useNearest = true),
        ),
        rowProfile = rowProfile(mask, size),
        columnProfile = columnProfile(mask, size),
        mainDiagonalProfile = mainDiagonalProfile(mask, size),
        antiDiagonalProfile = antiDiagonalProfile(mask, size),
        featureVector = buildShapeFeatureVector(mask, outlineMask, size),
        rawGray = sample.optJSONArray("rawGray")?.toIntArray(),
      )
    }
    return parsed
  }

  private fun writeShapeSamples(samplesByShape: Map<String, List<ShapeObservation>>) {
    val sampleDir = File(context.filesDir, SHAPE_SAMPLE_DIRNAME).apply { mkdirs() }
    SHAPE_ASSET_NAMES.keys.forEach { shapeName ->
      val samples = samplesByShape[shapeName].orEmpty()
      val root = JSONObject()
      val array = JSONArray()
      samples.forEach { sample ->
        val sampleObject = JSONObject()
          .put("maskBits", booleanArrayToBitString(sample.mask))
        sample.rawGray?.let { sampleObject.put("rawGray", JSONArray(it.toList())) }
        array.put(sampleObject)
      }
      root.put("shape", shapeName)
      root.put("samples", array)
      File(sampleDir, "$shapeName.json").writeText(root.toString(2))
    }
    cachedLearnedShapePrototypes = null
  }

  private fun persistLatestShapeObservation(observation: ShapeObservation?) {
    if (observation == null) return

    try {
      File(context.filesDir, LATEST_SHAPE_OBSERVATION_FILENAME).writeText(
        JSONObject().apply {
          put("maskBits", booleanArrayToBitString(observation.mask))
          observation.rawGray?.let { put("rawGray", JSONArray(it.toList())) }
        }.toString()
      )
    } catch (_: Exception) {
    }
  }

  private fun loadLatestShapeObservation(): ShapeObservation? {
    val latestFile = File(context.filesDir, LATEST_SHAPE_OBSERVATION_FILENAME)
    if (!latestFile.exists()) return null

    return try {
      val root = JSONObject(latestFile.readText())
      val maskBits = root.optString("maskBits")
      val mask = bitStringToBooleanArray(maskBits, size * size) ?: return null
      val outlineMask = extractOutlineMask(mask, size)
      ShapeObservation(
        mask = mask,
        outlineMask = outlineMask,
        pointCloud = buildOuterShapePointCloud(mask, outlineMask, size),
        outerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = false),
        innerContourProfile = buildContourRadiusProfile(outlineMask, size, useNearest = true),
        contourTurnProfile = buildContourTurnProfile(buildContourRadiusProfile(outlineMask, size, useNearest = false)),
        contourThicknessProfile = buildContourThicknessProfile(
          buildContourRadiusProfile(outlineMask, size, useNearest = false),
          buildContourRadiusProfile(outlineMask, size, useNearest = true),
        ),
        rowProfile = rowProfile(mask, size),
        columnProfile = columnProfile(mask, size),
        mainDiagonalProfile = mainDiagonalProfile(mask, size),
        antiDiagonalProfile = antiDiagonalProfile(mask, size),
        featureVector = buildShapeFeatureVector(mask, outlineMask, size),
        rawGray = root.optJSONArray("rawGray")?.toIntArray(),
      )
    } catch (_: Exception) {
      null
    }
  }

  private fun buildObservedShapeGray(bitmap: Bitmap, dimension: Int): IntArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, dimension, dimension, true)
    val gray = IntArray(dimension * dimension)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        gray[y * dimension + x] = luminance(scaled.getPixel(x, y)).coerceIn(0, 255)
      }
    }
    scaled.recycle()
    return gray
  }

  private fun buildTemplateShapeGray(assetPath: String, dimension: Int): IntArray? {
    return try {
      context.assets.open(assetPath).use { stream ->
        val bitmap = BitmapFactory.decodeStream(stream) ?: return null
        val scaled = Bitmap.createScaledBitmap(bitmap, dimension, dimension, true)
        val gray = IntArray(dimension * dimension)
        for (y in 0 until dimension) {
          for (x in 0 until dimension) {
            val color = scaled.getPixel(x, y)
            gray[y * dimension + x] = if (Color.alpha(color) <= 12) 0 else luminance(color).coerceIn(0, 255)
          }
        }
        scaled.recycle()
        bitmap.recycle()
        gray
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun writeShapeCropExport(shapeName: String, observation: ShapeObservation) {
    val rawGray = observation.rawGray ?: return
    try {
      val dir = File(context.filesDir, SHAPE_CROP_EXPORT_DIRNAME).resolve(shapeName).apply { mkdirs() }
      val bitmap = grayToBitmap(rawGray, size)
      val file = File(dir, "shape-${System.currentTimeMillis()}.png")
      FileOutputStream(file).use { out ->
        bitmap.compress(CompressFormat.PNG, 100, out)
      }
      bitmap.recycle()
    } catch (_: Exception) {
    }
  }

  private fun grayRegionAverage(
    gray: IntArray,
    dimension: Int,
    startX: Int,
    endX: Int,
    startY: Int,
    endY: Int,
  ): Double {
    var total = 0.0
    var count = 0
    val clampedStartX = startX.coerceIn(0, dimension - 1)
    val clampedEndX = endX.coerceIn(clampedStartX + 1, dimension)
    val clampedStartY = startY.coerceIn(0, dimension - 1)
    val clampedEndY = endY.coerceIn(clampedStartY + 1, dimension)
    for (y in clampedStartY until clampedEndY) {
      for (x in clampedStartX until clampedEndX) {
        total += gray[y * dimension + x].toDouble() / 255.0
        count += 1
      }
    }
    return total / max(1, count).toDouble()
  }

  private fun grayColumnAverage(
    gray: IntArray,
    dimension: Int,
    x: Int,
    startY: Int,
    endY: Int,
  ): Double {
    val clampedX = x.coerceIn(0, dimension - 1)
    var total = 0.0
    var count = 0
    val clampedStartY = startY.coerceIn(0, dimension - 1)
    val clampedEndY = endY.coerceIn(clampedStartY + 1, dimension)
    for (y in clampedStartY until clampedEndY) {
      total += gray[y * dimension + clampedX].toDouble() / 255.0
      count += 1
    }
    return total / max(1, count).toDouble()
  }

  private fun speedSetGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val centerX = (dimension * 0.50f).toInt()
    val centerY = (dimension * 0.50f).toInt()
    val vertical = columnActiveCount(mask, dimension, centerX).toDouble() / max(1, dimension).toDouble()
    val horizontal = rowActiveCount(mask, dimension, centerY).toDouble() / max(1, dimension).toDouble()
    val mainDiagonal = mainDiagonalProfile(mask, dimension).average()
    val antiDiagonal = antiDiagonalProfile(mask, dimension).average()
    val cornerDensity = averageCornerDensity(mask, dimension)

    var bonus = 0.0
    if (vertical >= 0.20 && horizontal >= 0.20) bonus += 0.045
    if (mainDiagonal >= 0.16 || antiDiagonal >= 0.16) bonus += 0.020
    if (cornerDensity <= 0.10) bonus += 0.010
    return bonus
  }

  private fun healthSetGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val radial = radialBalance(mask, dimension)
    val cornerDensity = averageCornerDensity(mask, dimension)
    val upperWidth = rowActiveCount(mask, dimension, (dimension * 0.30f).toInt()).toDouble() / max(1, dimension).toDouble()
    val lowerWidth = rowActiveCount(mask, dimension, (dimension * 0.70f).toInt()).toDouble() / max(1, dimension).toDouble()

    var bonus = 0.0
    if (radial >= 0.82) bonus += 0.025
    if (cornerDensity <= 0.12) bonus += 0.015
    if (upperWidth > 0.18 && lowerWidth > 0.18) bonus += 0.010
    return bonus
  }

  private fun offenseSetGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val centerX = (dimension * 0.50f).toInt()
    val centerY = (dimension * 0.50f).toInt()
    val vertical = columnActiveCount(mask, dimension, centerX).toDouble() / max(1, dimension).toDouble()
    val horizontal = rowActiveCount(mask, dimension, centerY).toDouble() / max(1, dimension).toDouble()
    val cornerDensity = averageCornerDensity(mask, dimension)

    var bonus = 0.0
    if (vertical >= 0.22 && horizontal >= 0.22) bonus += 0.025
    if (cornerDensity in 0.07..0.18) bonus += 0.010
    return bonus
  }

  private fun critDamageSetGeometryBonus(mask: BooleanArray, dimension: Int): Double {
    val diagonalStrength = (mainDiagonalProfile(mask, dimension).average() + antiDiagonalProfile(mask, dimension).average()) / 2.0
    val centerMass = regionDensity(
      mask,
      dimension,
      (dimension * 0.30f).toInt(),
      (dimension * 0.70f).toInt(),
      (dimension * 0.30f).toInt(),
      (dimension * 0.70f).toInt(),
    )

    var bonus = 0.0
    if (diagonalStrength >= 0.15) bonus += 0.020
    if (centerMass >= 0.14) bonus += 0.010
    return bonus
  }

  private fun compareGrayArrays(observed: IntArray, template: IntArray): Double {
    if (observed.isEmpty() || template.isEmpty() || observed.size != template.size) return 0.0
    var totalDifference = 0.0
    for (index in observed.indices) {
      totalDifference += kotlin.math.abs(observed[index] - template[index]).toDouble() / 255.0
    }
    val normalizedDifference = totalDifference / observed.size.toDouble()
    return (1.0 - normalizedDifference).coerceIn(0.0, 1.0)
  }

  private fun buildModelFeatureVector(
    primaryMask: BooleanArray,
    edgeMask: BooleanArray,
    gray: IntArray,
    rowProfile: DoubleArray,
    columnProfile: DoubleArray,
    edgeRowProfile: DoubleArray,
    edgeColumnProfile: DoubleArray,
    featureProfile: DoubleArray,
    dimension: Int,
    profile: String,
  ): DoubleArray {
    val centroid = centroidOf(primaryMask, dimension) ?: Pair(dimension / 2.0, dimension / 2.0)
    val grayAverage = if (gray.isNotEmpty()) gray.average() / 255.0 else 0.0
    val graySpread = if (gray.isNotEmpty()) {
      val mean = gray.average()
      sqrt(gray.fold(0.0) { total, value ->
        val delta = value - mean
        total + (delta * delta)
      } / gray.size.toDouble()) / 255.0
    } else {
      0.0
    }
    val primaryOccupancy = primaryMask.count { it }.toDouble() / max(1, primaryMask.size).toDouble()
    val edgeOccupancy = edgeMask.count { it }.toDouble() / max(1, edgeMask.size).toDouble()

    if (profile == "arrow") {
      return buildArrowRasterFeatureVector(
        primaryMask = primaryMask,
        edgeMask = edgeMask,
        gray = gray,
        dimension = dimension,
      )
    }

    // Mask-masked gray statistics: restrict gray average/spread to pixels
    // inside the primary symbol mask. This strips background-color bias
    // (teal vs orange vs red) from the feature vector while keeping useful
    // information about the symbol's internal luminance variation.
    var maskedSum = 0.0
    var maskedSumSq = 0.0
    var maskedCount = 0
    for (index in gray.indices) {
      if (!primaryMask[index]) continue
      val v = gray[index].toDouble() / 255.0
      maskedSum += v
      maskedSumSq += v * v
      maskedCount += 1
    }
    val maskedMean = if (maskedCount > 0) maskedSum / maskedCount else 0.0
    val maskedVar = if (maskedCount > 0) (maskedSumSq / maskedCount) - (maskedMean * maskedMean) else 0.0
    val maskedStd = if (maskedVar > 0.0) sqrt(maskedVar) else 0.0

    val values = ArrayList<Double>(featureProfile.size + 14)
    featureProfile.forEach(values::add)
    values += primaryOccupancy
    values += edgeOccupancy
    values += radialBalance(primaryMask, dimension)
    values += averageCornerDensity(primaryMask, dimension)
    values += (centroid.first / max(1.0, dimension.toDouble()))
    values += (centroid.second / max(1.0, dimension.toDouble()))
    values += rowProfile.average()
    values += columnProfile.average()
    values += edgeRowProfile.average()
    values += edgeColumnProfile.average()
    values += maskedMean
    values += maskedStd
    values += normalizedTransitions(rowTransitions(primaryMask, dimension, (dimension * 0.50f).toInt()), dimension)
    values += normalizedTransitions(columnTransitions(primaryMask, dimension, (dimension * 0.50f).toInt()), dimension)
    return values.toDoubleArray()
  }

  private fun buildArrowRasterFeatureVector(
    primaryMask: BooleanArray,
    edgeMask: BooleanArray,
    gray: IntArray,
    dimension: Int,
  ): DoubleArray {
    val rasterSize = 12
    val values = ArrayList<Double>((rasterSize * rasterSize * 3) + 10)

    for (gridY in 0 until rasterSize) {
      for (gridX in 0 until rasterSize) {
        val startX = (gridX * dimension) / rasterSize
        val endX = ((gridX + 1) * dimension) / rasterSize
        val startY = (gridY * dimension) / rasterSize
        val endY = ((gridY + 1) * dimension) / rasterSize

        var primaryActive = 0
        var edgeActive = 0
        var grayTotal = 0.0
        var total = 0

        for (y in startY until endY.coerceAtLeast(startY + 1).coerceAtMost(dimension)) {
          for (x in startX until endX.coerceAtLeast(startX + 1).coerceAtMost(dimension)) {
            val index = y * dimension + x
            total += 1
            if (primaryMask[index]) primaryActive += 1
            if (edgeMask[index]) edgeActive += 1
            grayTotal += gray[index].toDouble() / 255.0
          }
        }

        val safeTotal = max(1, total).toDouble()
        val primaryDensity = primaryActive.toDouble() / safeTotal
        val edgeDensity = edgeActive.toDouble() / safeTotal
        val grayDensity = grayTotal / safeTotal

        // Arrow sets need the interior grayscale detail more than the shared burst silhouette.
        values += grayDensity
        values += edgeDensity * 0.55
        values += primaryDensity * 0.25
      }
    }

    val centroid = centroidOf(primaryMask, dimension) ?: Pair(dimension / 2.0, dimension / 2.0)
    values += gray.average() / 255.0
    values += primaryMask.count { it }.toDouble() / max(1, primaryMask.size).toDouble() * 0.30
    values += edgeMask.count { it }.toDouble() / max(1, edgeMask.size).toDouble() * 0.60
    values += (centroid.first / max(1.0, dimension.toDouble()))
    values += (centroid.second / max(1.0, dimension.toDouble()))
    values += normalizedTransitions(rowTransitions(primaryMask, dimension, (dimension * 0.35f).toInt()), dimension) * 0.45
    values += normalizedTransitions(rowTransitions(primaryMask, dimension, (dimension * 0.50f).toInt()), dimension) * 0.45
    values += normalizedTransitions(columnTransitions(primaryMask, dimension, (dimension * 0.50f).toInt()), dimension) * 0.45
    values += averageCornerDensity(primaryMask, dimension) * 0.35
    values += averageCornerDensity(edgeMask, dimension) * 0.55
    return values.toDoubleArray()
  }

  private fun symbolFeatureProfile(
    primaryMask: BooleanArray,
    edgeMask: BooleanArray,
    dimension: Int,
    profile: String,
  ): DoubleArray {
    val features = mutableListOf<Double>()
    val left = (dimension * 0.18f).toInt()
    val right = (dimension * 0.82f).toInt()
    val top = (dimension * 0.18f).toInt()
    val bottom = (dimension * 0.82f).toInt()
    val thirdWidth = max(1, (right - left) / 3)
    val thirdHeight = max(1, (bottom - top) / 3)

    features += regionDensity(primaryMask, dimension, left, left + thirdWidth, top, bottom)
    features += regionDensity(primaryMask, dimension, left + thirdWidth, right - thirdWidth, top, bottom)
    features += regionDensity(primaryMask, dimension, right - thirdWidth, right, top, bottom)

    features += regionDensity(primaryMask, dimension, left, right, top, top + thirdHeight)
    features += regionDensity(primaryMask, dimension, left, right, top + thirdHeight, bottom - thirdHeight)
    features += regionDensity(primaryMask, dimension, left, right, bottom - thirdHeight, bottom)

    features += regionDensity(primaryMask, dimension, left, left + thirdWidth, top, top + thirdHeight)
    features += regionDensity(primaryMask, dimension, right - thirdWidth, right, top, top + thirdHeight)
    features += regionDensity(primaryMask, dimension, left, left + thirdWidth, bottom - thirdHeight, bottom)
    features += regionDensity(primaryMask, dimension, right - thirdWidth, right, bottom - thirdHeight, bottom)

    val centerBoxStartX = (dimension * 0.38f).toInt()
    val centerBoxEndX = (dimension * 0.62f).toInt()
    val centerBoxStartY = (dimension * 0.36f).toInt()
    val centerBoxEndY = (dimension * 0.64f).toInt()
    features += regionDensity(primaryMask, dimension, centerBoxStartX, centerBoxEndX, centerBoxStartY, centerBoxEndY)
    features += regionDensity(edgeMask, dimension, centerBoxStartX, centerBoxEndX, centerBoxStartY, centerBoxEndY)

    val upperBandY = (dimension * 0.30f).toInt()
    val middleBandY = (dimension * 0.50f).toInt()
    val lowerBandY = (dimension * 0.70f).toInt()
    val leftBandX = (dimension * 0.32f).toInt()
    val middleBandX = (dimension * 0.50f).toInt()
    val rightBandX = (dimension * 0.68f).toInt()
    features += normalizedTransitions(rowTransitions(primaryMask, dimension, upperBandY), dimension)
    features += normalizedTransitions(rowTransitions(primaryMask, dimension, middleBandY), dimension)
    features += normalizedTransitions(rowTransitions(primaryMask, dimension, lowerBandY), dimension)
    features += normalizedTransitions(columnTransitions(primaryMask, dimension, leftBandX), dimension)
    features += normalizedTransitions(columnTransitions(primaryMask, dimension, middleBandX), dimension)
    features += normalizedTransitions(columnTransitions(primaryMask, dimension, rightBandX), dimension)

    if (profile == "arrow") {
      features += regionDensity(primaryMask, dimension, (dimension * 0.24f).toInt(), (dimension * 0.44f).toInt(), (dimension * 0.22f).toInt(), (dimension * 0.78f).toInt())
      features += regionDensity(primaryMask, dimension, (dimension * 0.44f).toInt(), (dimension * 0.72f).toInt(), (dimension * 0.22f).toInt(), (dimension * 0.78f).toInt())
      features += normalizedTransitions(rowTransitions(edgeMask, dimension, middleBandY), dimension)
      features += normalizedTransitions(columnTransitions(edgeMask, dimension, middleBandX), dimension)
      features += radialBalance(primaryMask, dimension)
    }

    return features.toDoubleArray()
  }

  private fun rowProfile(mask: BooleanArray, dimension: Int): DoubleArray {
    val profile = DoubleArray(dimension)
    for (y in 0 until dimension) {
      var active = 0
      for (x in 0 until dimension) {
        if (mask[y * dimension + x]) active += 1
      }
      profile[y] = active.toDouble() / max(1, dimension).toDouble()
    }
    return profile
  }

  private fun rowTransitions(mask: BooleanArray, dimension: Int, y: Int): Int {
    val safeY = y.coerceIn(0, dimension - 1)
    var transitions = 0
    var previous = false
    for (x in 0 until dimension) {
      val active = mask[safeY * dimension + x]
      if (x > 0 && active != previous) {
        transitions += 1
      }
      previous = active
    }
    return transitions
  }

  private fun columnTransitions(mask: BooleanArray, dimension: Int, x: Int): Int {
    val safeX = x.coerceIn(0, dimension - 1)
    var transitions = 0
    var previous = false
    for (y in 0 until dimension) {
      val active = mask[y * dimension + safeX]
      if (y > 0 && active != previous) {
        transitions += 1
      }
      previous = active
    }
    return transitions
  }

  private fun normalizedTransitions(transitions: Int, dimension: Int): Double {
    return (transitions.toDouble() / max(1, dimension / 2).toDouble()).coerceIn(0.0, 1.0)
  }

  private fun maskToBitmap(mask: BooleanArray, dimension: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(dimension, dimension, Bitmap.Config.ARGB_8888)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val color = if (mask[y * dimension + x]) Color.WHITE else Color.BLACK
        bitmap.setPixel(x, y, color)
      }
    }
    return bitmap
  }

  private fun grayToBitmap(gray: IntArray, dimension: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(dimension, dimension, Bitmap.Config.ARGB_8888)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val value = gray[y * dimension + x].coerceIn(0, 255)
        bitmap.setPixel(x, y, Color.rgb(value, value, value))
      }
    }
    return bitmap
  }

  private fun writeDebugBitmap(file: File, bitmap: Bitmap) {
    file.parentFile?.mkdirs()
    try {
      file.outputStream().use { stream ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        stream.flush()
      }
    } finally {
      bitmap.recycle()
    }
  }

  private fun slugifyDebugName(value: String): String {
    return value
      .lowercase()
      .replace(Regex("[^a-z0-9]+"), "-")
      .trim('-')
  }

  private fun JSONArray.toDoubleArray(): DoubleArray {
    return DoubleArray(length()) { index ->
      optDouble(index, 0.0)
    }
  }

  private fun JSONArray.toIntArray(): IntArray {
    return IntArray(length()) { index ->
      optInt(index, 0)
    }
  }

  private fun JSONArray.toStringList(): List<String> {
    return buildList {
      for (index in 0 until length()) {
        val value = optString(index)
        if (value.isNotBlank()) {
          add(value)
        }
      }
    }
  }

  private fun booleanArrayToBitString(values: BooleanArray): String {
    val builder = StringBuilder(values.size)
    values.forEach { builder.append(if (it) '1' else '0') }
    return builder.toString()
  }

  private fun bitStringToBooleanArray(bits: String, expectedSize: Int): BooleanArray? {
    if (bits.length != expectedSize) return null
    return BooleanArray(expectedSize) { index -> bits[index] == '1' }
  }

  private fun columnProfile(mask: BooleanArray, dimension: Int): DoubleArray {
    val profile = DoubleArray(dimension)
    for (x in 0 until dimension) {
      var active = 0
      for (y in 0 until dimension) {
        if (mask[y * dimension + x]) active += 1
      }
      profile[x] = active.toDouble() / max(1, dimension).toDouble()
    }
    return profile
  }

  private fun columnActiveCount(mask: BooleanArray, dimension: Int, x: Int): Int {
    val safeX = x.coerceIn(0, dimension - 1)
    var count = 0
    for (y in 0 until dimension) {
      if (mask[y * dimension + safeX]) count += 1
    }
    return count
  }

  private fun compareOccupancy(observed: BooleanArray, template: BooleanArray): Double {
    val observedCount = observed.count { it }
    val templateCount = template.count { it }
    val maxCount = max(1, max(observedCount, templateCount))
    return (1.0 - (kotlin.math.abs(observedCount - templateCount).toDouble() / maxCount.toDouble())).coerceIn(0.0, 1.0)
  }

  private fun compareCentroids(observed: BooleanArray, template: BooleanArray, dimension: Int): Double {
    val observedCentroid = centroidOf(observed, dimension) ?: return 0.0
    val templateCentroid = centroidOf(template, dimension) ?: return 0.0
    val xDiff = kotlin.math.abs(observedCentroid.first - templateCentroid.first) / max(1.0, dimension.toDouble())
    val yDiff = kotlin.math.abs(observedCentroid.second - templateCentroid.second) / max(1.0, dimension.toDouble())
    return (1.0 - ((xDiff + yDiff) / 2.0)).coerceIn(0.0, 1.0)
  }

  private fun centroidOf(mask: BooleanArray, dimension: Int): Pair<Double, Double>? {
    var total = 0
    var sumX = 0.0
    var sumY = 0.0
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        if (mask[y * dimension + x]) {
          total += 1
          sumX += x.toDouble()
          sumY += y.toDouble()
        }
      }
    }
    if (total == 0) return null
    return Pair(sumX / total.toDouble(), sumY / total.toDouble())
  }

  private fun mainDiagonalProfile(mask: BooleanArray, dimension: Int): DoubleArray {
    val profile = DoubleArray((dimension * 2) - 1)
    val counts = IntArray((dimension * 2) - 1)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val index = x - y + (dimension - 1)
        counts[index] += 1
        if (mask[y * dimension + x]) profile[index] += 1.0
      }
    }
    for (index in profile.indices) {
      profile[index] = profile[index] / max(1, counts[index]).toDouble()
    }
    return profile
  }

  private fun antiDiagonalProfile(mask: BooleanArray, dimension: Int): DoubleArray {
    val profile = DoubleArray((dimension * 2) - 1)
    val counts = IntArray((dimension * 2) - 1)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val index = x + y
        counts[index] += 1
        if (mask[y * dimension + x]) profile[index] += 1.0
      }
    }
    for (index in profile.indices) {
      profile[index] = profile[index] / max(1, counts[index]).toDouble()
    }
    return profile
  }

  private fun averageCornerDensity(mask: BooleanArray, dimension: Int): Double {
    val band = (dimension * 0.22f).toInt().coerceAtLeast(1)
    val corners = listOf(
      regionDensity(mask, dimension, 0, band, 0, band),
      regionDensity(mask, dimension, dimension - band, dimension, 0, band),
      regionDensity(mask, dimension, 0, band, dimension - band, dimension),
      regionDensity(mask, dimension, dimension - band, dimension, dimension - band, dimension),
    )
    return corners.average()
  }

  private fun radialBalance(mask: BooleanArray, dimension: Int): Double {
    val center = (dimension - 1) / 2.0
    val bucketCount = 6
    val totals = DoubleArray(bucketCount)
    val counts = IntArray(bucketCount)
    val maxDistance = kotlin.math.sqrt((center * center) + (center * center))

    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val dx = x - center
        val dy = y - center
        val distance = kotlin.math.sqrt((dx * dx) + (dy * dy))
        val normalized = (distance / maxDistance).coerceIn(0.0, 0.999)
        val bucket = (normalized * bucketCount).toInt().coerceIn(0, bucketCount - 1)
        counts[bucket] += 1
        if (mask[y * dimension + x]) {
          totals[bucket] += 1.0
        }
      }
    }

    val densities = DoubleArray(bucketCount) { index ->
      totals[index] / max(1, counts[index]).toDouble()
    }
    var totalDifference = 0.0
    for (index in 1 until densities.size) {
      totalDifference += kotlin.math.abs(densities[index] - densities[index - 1])
    }
    val normalizedDifference = totalDifference / max(1, densities.size - 1).toDouble()
    return (1.0 - normalizedDifference).coerceIn(0.0, 1.0)
  }

  private fun buildShapeFeatureVector(mask: BooleanArray, outlineMask: BooleanArray, dimension: Int): DoubleArray {
    val middleY = (dimension * 0.50f).toInt()
    val upperY = (dimension * 0.30f).toInt()
    val lowerY = (dimension * 0.70f).toInt()
    val middleX = (dimension * 0.50f).toInt()
    val leftX = (dimension * 0.30f).toInt()
    val rightX = (dimension * 0.70f).toInt()

    val values = arrayListOf<Double>()
    values += averageCornerDensity(mask, dimension)
    values += radialBalance(mask, dimension)
    values += arrowLikeAsymmetry(mask, dimension)
    values += rowActiveCount(mask, dimension, middleY).toDouble() / max(1, dimension).toDouble()
    values += rowActiveCount(mask, dimension, upperY).toDouble() / max(1, dimension).toDouble()
    values += rowActiveCount(mask, dimension, lowerY).toDouble() / max(1, dimension).toDouble()
    values += columnActiveCount(mask, dimension, middleX).toDouble() / max(1, dimension).toDouble()
    values += columnActiveCount(mask, dimension, leftX).toDouble() / max(1, dimension).toDouble()
    values += columnActiveCount(mask, dimension, rightX).toDouble() / max(1, dimension).toDouble()
    values += bandActiveCount(mask, dimension, 0.38f, 0.62f, true).toDouble() / (dimension * dimension).toDouble()
    values += bandActiveCount(mask, dimension, 0.38f, 0.62f, false).toDouble() / (dimension * dimension).toDouble()
    values += bandActiveCount(outlineMask, dimension, 0.38f, 0.62f, true).toDouble() / (dimension * dimension).toDouble()
    values += bandActiveCount(outlineMask, dimension, 0.38f, 0.62f, false).toDouble() / (dimension * dimension).toDouble()
    values += regionDensity(mask, dimension, 0, dimension / 2, 0, dimension / 2)
    values += regionDensity(mask, dimension, dimension / 2, dimension, 0, dimension / 2)
    values += regionDensity(mask, dimension, 0, dimension / 2, dimension / 2, dimension)
    values += regionDensity(mask, dimension, dimension / 2, dimension, dimension / 2, dimension)
    return values.toDoubleArray()
  }

  private fun blackoutShapeCenter(mask: BooleanArray, dimension: Int): BooleanArray {
    val blacked = mask.copyOf()
    val centerX = (dimension - 1) / 2.0
    val centerY = (dimension - 1) / 2.0
    val radiusX = max(1.0, dimension * 0.09)
    val radiusY = max(1.0, dimension * 0.09)
    val centerLeft = (centerX - (dimension * 0.11)).toInt().coerceAtLeast(0)
    val centerRight = (centerX + (dimension * 0.11)).toInt().coerceAtMost(dimension - 1)
    val centerTop = (centerY - (dimension * 0.11)).toInt().coerceAtLeast(0)
    val centerBottom = (centerY + (dimension * 0.11)).toInt().coerceAtMost(dimension - 1)
    for (y in centerTop..centerBottom) {
      for (x in centerLeft..centerRight) {
        val dx = (x - centerX) / radiusX
        val dy = (y - centerY) / radiusY
        if (((dx * dx) + (dy * dy)) <= 1.0) {
          blacked[y * dimension + x] = false
        }
      }
    }
    return blacked
  }

  private fun regionDensity(mask: BooleanArray, dimension: Int, startX: Int, endX: Int, startY: Int, endY: Int): Double {
    var active = 0
    var total = 0
    for (y in startY until endY.coerceAtMost(dimension)) {
      for (x in startX until endX.coerceAtMost(dimension)) {
        total += 1
        if (mask[y * dimension + x]) active += 1
      }
    }
    if (total == 0) return 0.0
    return active.toDouble() / total.toDouble()
  }

  private fun trimOuterMask(mask: BooleanArray, dimension: Int, marginRatio: Float): BooleanArray {
    val trimmed = mask.copyOf()
    val margin = (dimension * marginRatio).toInt().coerceAtLeast(1)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        if (
          x < margin ||
          y < margin ||
          x >= dimension - margin ||
          y >= dimension - margin
        ) {
          trimmed[y * dimension + x] = false
        }
      }
    }
    return trimmed
  }

  private fun normalizeShapeMask(mask: BooleanArray, dimension: Int): BooleanArray {
    val filtered = isolateOuterShape(mask, dimension)
    return recenterAndScaleMask(filtered, dimension, 0.88)
  }

  private fun mergeMasks(primary: BooleanArray, secondary: BooleanArray): BooleanArray {
    val merged = BooleanArray(primary.size)
    for (index in primary.indices) {
      merged[index] = primary[index] || secondary.getOrNull(index) == true
    }
    return merged
  }

  private fun intersectMasks(primary: BooleanArray, secondary: BooleanArray): BooleanArray {
    val intersection = BooleanArray(primary.size)
    for (index in primary.indices) {
      intersection[index] = primary[index] && (secondary.getOrNull(index) == true)
    }
    return intersection
  }

  private fun maskDensity(mask: BooleanArray): Double {
    if (mask.isEmpty()) return 0.0
    var active = 0
    for (value in mask) {
      if (value) active += 1
    }
    return active.toDouble() / mask.size.toDouble()
  }

  private fun extractOutlineMask(mask: BooleanArray, dimension: Int): BooleanArray {
    val outline = BooleanArray(mask.size)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val index = y * dimension + x
        if (!mask[index]) continue
        var boundary = x == 0 || y == 0 || x == dimension - 1 || y == dimension - 1
        if (!boundary) {
          boundary =
            !mask[index - 1] ||
            !mask[index + 1] ||
            !mask[index - dimension] ||
            !mask[index + dimension]
        }
        outline[index] = boundary
      }
    }
    return outline
  }

  private fun buildContourRadiusProfile(
    outlineMask: BooleanArray,
    dimension: Int,
    useNearest: Boolean,
  ): DoubleArray {
    val minDistances = DoubleArray(CONTOUR_PROFILE_BUCKETS) { Double.POSITIVE_INFINITY }
    val maxDistances = DoubleArray(CONTOUR_PROFILE_BUCKETS) { 0.0 }
    val cx = (dimension - 1) / 2.0
    val cy = (dimension - 1) / 2.0
    val maxRadius = kotlin.math.hypot(cx, cy).coerceAtLeast(1.0)

    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        if (!outlineMask[y * dimension + x]) continue
        val dx = x - cx
        val dy = y - cy
        val distance = kotlin.math.hypot(dx, dy) / maxRadius
        var angle = kotlin.math.atan2(dy, dx)
        if (angle < 0.0) angle += Math.PI * 2.0
        val bucket = ((angle / (Math.PI * 2.0)) * CONTOUR_PROFILE_BUCKETS).toInt().coerceIn(0, CONTOUR_PROFILE_BUCKETS - 1)
        if (distance < minDistances[bucket]) minDistances[bucket] = distance
        if (distance > maxDistances[bucket]) maxDistances[bucket] = distance
      }
    }

    val source = DoubleArray(CONTOUR_PROFILE_BUCKETS) { index ->
      val minDistance = minDistances[index]
      val maxDistance = maxDistances[index]
      when {
        useNearest && minDistance.isFinite() -> minDistance.coerceIn(0.0, 1.0)
        !useNearest && maxDistance > 0.0 -> maxDistance.coerceIn(0.0, 1.0)
        else -> Double.NaN
      }
    }
    return fillMissingContourBuckets(source)
  }

  private fun fillMissingContourBuckets(values: DoubleArray): DoubleArray {
    val filled = values.copyOf()
    val valid = filled.filter { !it.isNaN() }
    val fallback = if (valid.isNotEmpty()) valid.average() else 0.0
    for (index in filled.indices) {
      if (!filled[index].isNaN()) continue
      var resolved = Double.NaN
      for (offset in 1 until filled.size) {
        val left = filled[(index - offset + filled.size) % filled.size]
        val right = filled[(index + offset) % filled.size]
        if (!left.isNaN() && !right.isNaN()) {
          resolved = (left + right) / 2.0
          break
        }
        if (!left.isNaN()) {
          resolved = left
          break
        }
        if (!right.isNaN()) {
          resolved = right
          break
        }
      }
      filled[index] = if (resolved.isNaN()) fallback else resolved
    }
    return filled
  }

  private fun buildContourTurnProfile(outerContourProfile: DoubleArray): DoubleArray {
    if (outerContourProfile.isEmpty()) return DoubleArray(0)
    return DoubleArray(outerContourProfile.size) { index ->
      val prev = outerContourProfile[(index - 1 + outerContourProfile.size) % outerContourProfile.size]
      val current = outerContourProfile[index]
      val next = outerContourProfile[(index + 1) % outerContourProfile.size]
      kotlin.math.abs(next - current) + kotlin.math.abs(current - prev)
    }.let { normalizeContourSeries(it) }
  }

  private fun buildContourThicknessProfile(
    outerContourProfile: DoubleArray,
    innerContourProfile: DoubleArray,
  ): DoubleArray {
    val size = minOf(outerContourProfile.size, innerContourProfile.size)
    return DoubleArray(size) { index ->
      (outerContourProfile[index] - innerContourProfile[index]).coerceAtLeast(0.0)
    }.let { normalizeContourSeries(it) }
  }

  private fun normalizeContourSeries(values: DoubleArray): DoubleArray {
    if (values.isEmpty()) return values
    val maxValue = values.maxOrNull()?.coerceAtLeast(1e-6) ?: 1.0
    return DoubleArray(values.size) { index -> (values[index] / maxValue).coerceIn(0.0, 1.0) }
  }

  private fun cleanupRoundShapeMask(mask: BooleanArray, dimension: Int): BooleanArray {
    val closed = erodeMask(dilateMask(mask, dimension, radius = 1), dimension, radius = 1)
    val majority = majoritySmoothMask(closed, dimension)
    return isolateOuterShape(majority, dimension)
  }

  private fun keepOuterRingBand(mask: BooleanArray, dimension: Int): BooleanArray {
    val filtered = BooleanArray(mask.size)
    val cx = (dimension - 1) / 2.0
    val cy = (dimension - 1) / 2.0
    val maxRadius = kotlin.math.hypot(cx, cy).coerceAtLeast(1.0)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val index = y * dimension + x
        if (!mask[index]) continue
        val radius = kotlin.math.hypot(x - cx, y - cy) / maxRadius
        if (radius in 0.34..0.92) {
          filtered[index] = true
        }
      }
    }
    return isolateOuterShape(filtered, dimension)
  }

  private fun keepOuterRoundEdgeComponents(mask: BooleanArray, dimension: Int): BooleanArray {
    data class EdgeComponent(
      val pixels: List<Int>,
      val count: Int,
      val minX: Int,
      val maxX: Int,
      val minY: Int,
      val maxY: Int,
      val centroidX: Double,
      val centroidY: Double,
    )

    val visited = BooleanArray(mask.size)
    val queue = ArrayDeque<Int>()
    val components = mutableListOf<EdgeComponent>()
    val cx = (dimension - 1) / 2.0
    val cy = (dimension - 1) / 2.0
    val maxRadius = kotlin.math.hypot(cx, cy).coerceAtLeast(1.0)

    for (index in mask.indices) {
      if (!mask[index] || visited[index]) continue
      visited[index] = true
      queue.clear()
      queue.add(index)
      val pixels = mutableListOf<Int>()
      var minX = dimension
      var maxX = -1
      var minY = dimension
      var maxY = -1
      var sumX = 0.0
      var sumY = 0.0

      while (queue.isNotEmpty()) {
        val current = queue.removeFirst()
        pixels += current
        val x = current % dimension
        val y = current / dimension
        minX = minOf(minX, x)
        maxX = maxOf(maxX, x)
        minY = minOf(minY, y)
        maxY = maxOf(maxY, y)
        sumX += x
        sumY += y

        val neighbors = intArrayOf(
          current - 1,
          current + 1,
          current - dimension,
          current + dimension,
        )
        neighbors.forEach { neighbor ->
          if (neighbor !in mask.indices || visited[neighbor] || !mask[neighbor]) return@forEach
          val nx = neighbor % dimension
          val ny = neighbor / dimension
          if (kotlin.math.abs(nx - x) + kotlin.math.abs(ny - y) != 1) return@forEach
          visited[neighbor] = true
          queue.add(neighbor)
        }
      }

      val count = pixels.size
      if (count == 0) continue
      components += EdgeComponent(
        pixels = pixels,
        count = count,
        minX = minX,
        maxX = maxX,
        minY = minY,
        maxY = maxY,
        centroidX = sumX / count.toDouble(),
        centroidY = sumY / count.toDouble(),
      )
    }

    if (components.isEmpty()) return mask
    val largest = components.maxOf { it.count }
    val keepMask = BooleanArray(mask.size)

    components.forEach { component ->
      val bboxWidth = (component.maxX - component.minX + 1).coerceAtLeast(1)
      val bboxHeight = (component.maxY - component.minY + 1).coerceAtLeast(1)
      val aspectRatio = max(bboxWidth, bboxHeight).toDouble() / max(1, minOf(bboxWidth, bboxHeight)).toDouble()
      val centroidRadius = kotlin.math.hypot(component.centroidX - cx, component.centroidY - cy) / maxRadius
      val touchesOuterBand =
        component.minX <= (dimension * 0.22f).toInt() ||
          component.maxX >= (dimension * 0.78f).toInt() ||
          component.minY <= (dimension * 0.22f).toInt() ||
          component.maxY >= (dimension * 0.78f).toInt()
      val substantial = component.count >= max(8, (largest * 0.18).toInt())
      val notSkinny = aspectRatio <= 6.0
      val outerish = centroidRadius >= 0.24
      if (touchesOuterBand && substantial && notSkinny && outerish) {
        component.pixels.forEach { keepMask[it] = true }
      }
    }

    return if (keepMask.any { it }) keepMask else mask
  }

  private fun buildObservedCircleBoundaryMask(bitmap: Bitmap): BooleanArray {
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val candidate = BooleanArray(size * size)
    val cx = (size - 1) / 2.0
    val cy = (size - 1) / 2.0
    val maxRadius = kotlin.math.hypot(cx, cy).coerceAtLeast(1.0)

    for (y in 1 until size - 1) {
      for (x in 1 until size - 1) {
        if (shouldIgnoreOuterShapeEdgePixel(x, y, size)) continue
        val radius = kotlin.math.hypot(x - cx, y - cy) / maxRadius
        if (radius < 0.34 || radius > 0.95) continue
        val color = scaled.getPixel(x, y)
        val luma = luminance(color)
        val sat = saturation(color)
        val contrast = localEdgeContrast(scaled, x, y, size)
        if (Color.alpha(color) > 18 && (luma > 28 || sat < 0.45f) && contrast > 9) {
          candidate[y * size + x] = true
        }
      }
    }
    scaled.recycle()

    val boundary = BooleanArray(size * size)
    for (y in 0 until size) {
      var left = -1
      var right = -1
      for (x in 0 until size) {
        if (candidate[y * size + x]) {
          left = x
          break
        }
      }
      for (x in size - 1 downTo 0) {
        if (candidate[y * size + x]) {
          right = x
          break
        }
      }
      if (left >= 0 && right >= 0 && (right - left) >= size * 0.22) {
        boundary[y * size + left] = true
        boundary[y * size + right] = true
      }
    }
    for (x in 0 until size) {
      var top = -1
      var bottom = -1
      for (y in 0 until size) {
        if (candidate[y * size + x]) {
          top = y
          break
        }
      }
      for (y in size - 1 downTo 0) {
        if (candidate[y * size + x]) {
          bottom = y
          break
        }
      }
      if (top >= 0 && bottom >= 0 && (bottom - top) >= size * 0.22) {
        boundary[top * size + x] = true
        boundary[bottom * size + x] = true
      }
    }

    return cleanupRoundShapeMask(keepOuterRoundEdgeComponents(boundary, size), size)
  }

  private fun buildRoundBoundaryMetrics(mask: BooleanArray, dimension: Int): RoundBoundaryMetrics {
    val points = outlinePoints(mask, dimension)
    if (points.size < 8) {
      return RoundBoundaryMetrics(
        score = 0.0,
        coverage = 0.0,
        radiusStd = 1.0,
        symmetry = 0.0,
        crossVeto = 1.0,
      )
    }
    val cx = (dimension - 1) / 2.0
    val cy = (dimension - 1) / 2.0
    val maxRadius = kotlin.math.hypot(cx, cy).coerceAtLeast(1.0)
    val radii = points.map { kotlin.math.hypot(it.first - cx, it.second - cy) / maxRadius }
    val meanRadius = radii.average().coerceAtLeast(1e-6)
    val radiusStd = kotlin.math.sqrt(radii.sumOf { (it - meanRadius) * (it - meanRadius) } / radii.size.toDouble())

    var coveredRows = 0
    for (y in 0 until dimension) {
      val left = rowFirstActive(mask, dimension, y)
      val right = rowLastActive(mask, dimension, y)
      if (left >= 0 && right >= 0 && (right - left) >= dimension * 0.20) coveredRows += 1
    }
    var coveredCols = 0
    for (x in 0 until dimension) {
      val top = columnFirstActive(mask, dimension, x)
      val bottom = columnLastActive(mask, dimension, x)
      if (top >= 0 && bottom >= 0 && (bottom - top) >= dimension * 0.20) coveredCols += 1
    }
    val coverage = ((coveredRows.toDouble() / dimension.toDouble()) + (coveredCols.toDouble() / dimension.toDouble())) / 2.0

    val horizontalSymmetry =
      1.0 - kotlin.math.abs(
        (rowFirstActive(mask, dimension, dimension / 2).toDouble().coerceAtLeast(0.0)) -
          (dimension - 1 - rowLastActive(mask, dimension, dimension / 2).toDouble().coerceAtLeast(0.0))
      ) / dimension.toDouble()
    val verticalSymmetry =
      1.0 - kotlin.math.abs(
        (columnFirstActive(mask, dimension, dimension / 2).toDouble().coerceAtLeast(0.0)) -
          (dimension - 1 - columnLastActive(mask, dimension, dimension / 2).toDouble().coerceAtLeast(0.0))
      ) / dimension.toDouble()
    val symmetry = ((horizontalSymmetry + verticalSymmetry) / 2.0).coerceIn(0.0, 1.0)

    val centerRowSpan = rowLastActive(mask, dimension, dimension / 2) - rowFirstActive(mask, dimension, dimension / 2)
    val centerColSpan = columnLastActive(mask, dimension, dimension / 2) - columnFirstActive(mask, dimension, dimension / 2)
    val horizontalBar = if (centerRowSpan > 0) centerRowSpan.toDouble() / dimension.toDouble() else 0.0
    val verticalBar = if (centerColSpan > 0) centerColSpan.toDouble() / dimension.toDouble() else 0.0
    val crossVeto = ((horizontalBar + verticalBar) / 2.0).coerceIn(0.0, 1.0)

    val score = (coverage * 0.45) + ((1.0 - radiusStd.coerceAtMost(1.0)) * 0.35) + (symmetry * 0.20)
    return RoundBoundaryMetrics(
      score = score.coerceIn(0.0, 1.0),
      coverage = coverage.coerceIn(0.0, 1.0),
      radiusStd = radiusStd.coerceIn(0.0, 1.0),
      symmetry = symmetry,
      crossVeto = crossVeto,
    )
  }

  private fun buildTriangleBoundaryMetrics(mask: BooleanArray, dimension: Int): TriangleBoundaryMetrics {
    fun rowSpan(y: Int): Triple<Int, Int, Int>? {
      val left = rowFirstActive(mask, dimension, y)
      val right = rowLastActive(mask, dimension, y)
      if (left < 0 || right < 0 || right <= left) return null
      return Triple(left, right, right - left + 1)
    }

    val topRows = ((dimension * 0.18f).toInt()..(dimension * 0.42f).toInt()).mapNotNull { y ->
      rowSpan(y)?.let { Triple(y, it.first + it.second, it.third) }
    }
    val bottomRows = ((dimension * 0.58f).toInt()..(dimension * 0.86f).toInt()).mapNotNull { y ->
      rowSpan(y)?.let { Triple(y, it.first + it.second, it.third) }
    }
    val tailRows = ((dimension * 0.78f).toInt()..(dimension * 0.94f).toInt()).mapNotNull { y ->
      rowSpan(y)?.let { Triple(y, it.first + it.second, it.third) }
    }

    if (topRows.isEmpty() || bottomRows.isEmpty() || tailRows.isEmpty()) {
      return TriangleBoundaryMetrics(
        score = 0.0,
        apexNarrowness = 0.0,
        baseWidth = 0.0,
        tailSupport = 0.0,
        centering = 0.0,
      )
    }

    val topWidth = topRows.map { it.third.toDouble() }.average() / dimension.toDouble()
    val bottomWidth = bottomRows.map { it.third.toDouble() }.average() / dimension.toDouble()
    val tailWidth = tailRows.map { it.third.toDouble() }.average() / dimension.toDouble()
    val apexNarrowness = (1.0 - (topWidth / bottomWidth.coerceAtLeast(1e-6))).coerceIn(0.0, 1.0)
    val baseWidth = bottomWidth.coerceIn(0.0, 1.0)
    val tailSupport = (tailWidth / bottomWidth.coerceAtLeast(1e-6)).coerceIn(0.0, 1.0)

    val topCenter = topRows.map { it.second.toDouble() / 2.0 }.average()
    val imageCenter = (dimension - 1) / 2.0
    val centering = (1.0 - (kotlin.math.abs(topCenter - imageCenter) / dimension.toDouble()) * 2.0).coerceIn(0.0, 1.0)

    val score = (
      (apexNarrowness * 0.40) +
        (baseWidth * 0.26) +
        (tailSupport * 0.22) +
        (centering * 0.12)
      ).coerceIn(0.0, 1.0)
    return TriangleBoundaryMetrics(
      score = score,
      apexNarrowness = apexNarrowness,
      baseWidth = baseWidth,
      tailSupport = tailSupport,
      centering = centering,
    )
  }

  private fun dilateMask(mask: BooleanArray, dimension: Int, radius: Int): BooleanArray {
    val dilated = BooleanArray(mask.size)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        if (!mask[y * dimension + x]) continue
        for (dy in -radius..radius) {
          for (dx in -radius..radius) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until dimension || ny !in 0 until dimension) continue
            dilated[ny * dimension + nx] = true
          }
        }
      }
    }
    return dilated
  }

  private fun closeMask(mask: BooleanArray, dimension: Int, radius: Int): BooleanArray {
    if (radius <= 0) return mask.copyOf()
    return erodeMask(dilateMask(mask, dimension, radius), dimension, radius)
  }

  private fun erodeMask(mask: BooleanArray, dimension: Int, radius: Int): BooleanArray {
    val eroded = BooleanArray(mask.size)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        var keep = true
        for (dy in -radius..radius) {
          for (dx in -radius..radius) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until dimension || ny !in 0 until dimension || !mask[ny * dimension + nx]) {
              keep = false
              break
            }
          }
          if (!keep) break
        }
        eroded[y * dimension + x] = keep
      }
    }
    return eroded
  }

  private fun majoritySmoothMask(mask: BooleanArray, dimension: Int): BooleanArray {
    val smoothed = BooleanArray(mask.size)
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        var activeNeighbors = 0
        var totalNeighbors = 0
        for (dy in -1..1) {
          for (dx in -1..1) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until dimension || ny !in 0 until dimension) continue
            totalNeighbors += 1
            if (mask[ny * dimension + nx]) activeNeighbors += 1
          }
        }
        val index = y * dimension + x
        smoothed[index] = if (mask[index]) {
          activeNeighbors >= 4
        } else {
          activeNeighbors >= kotlin.math.min(6, totalNeighbors)
        }
      }
    }
    return smoothed
  }

  private fun buildContourMetrics(
    observedMask: BooleanArray,
    observedOutlineMask: BooleanArray,
    observedOuterContourProfile: DoubleArray,
    observedContourTurnProfile: DoubleArray,
    smoothedRoundMask: BooleanArray,
    smoothedRoundOutlineMask: BooleanArray,
    smoothedRoundOuterContourProfile: DoubleArray,
    smoothedRoundContourTurnProfile: DoubleArray,
    dimension: Int,
  ): ContourMetrics {
    val circularity = shapeCircularity(observedMask, observedOutlineMask)
    val ellipseFitQuality = ellipseFitQuality(observedMask, dimension)
    val cornerCount = contourCornerCount(observedContourTurnProfile)
    val diagonalDominance = diagonalDominance(observedMask, dimension)
    val orthogonalDominance = orthogonalDominance(observedMask, observedOuterContourProfile, dimension)
    val smoothedCircularity = shapeCircularity(smoothedRoundMask, smoothedRoundOutlineMask)
    val smoothedEllipseFitQuality = ellipseFitQuality(smoothedRoundMask, dimension)
    val smoothedCornerCount = contourCornerCount(smoothedRoundContourTurnProfile)
    val smoothedOrthogonalDominance =
      orthogonalDominance(smoothedRoundMask, smoothedRoundOuterContourProfile, dimension)
    return ContourMetrics(
      circularity = circularity,
      ellipseFitQuality = ellipseFitQuality,
      cornerCount = cornerCount,
      diagonalDominance = diagonalDominance,
      orthogonalDominance = orthogonalDominance,
      smoothedCircularity = smoothedCircularity,
      smoothedEllipseFitQuality = smoothedEllipseFitQuality,
      smoothedCornerCount = smoothedCornerCount,
      smoothedOrthogonalDominance = smoothedOrthogonalDominance,
    )
  }

  private fun shapeCircularity(mask: BooleanArray, outlineMask: BooleanArray): Double {
    val area = mask.count { it }.toDouble()
    val perimeter = outlineMask.count { it }.toDouble().coerceAtLeast(1.0)
    if (area <= 0.0) return 0.0
    return ((4.0 * Math.PI * area) / (perimeter * perimeter)).coerceIn(0.0, 1.0)
  }

  private fun ellipseFitQuality(mask: BooleanArray, dimension: Int): Double {
    val points = mutableListOf<Pair<Double, Double>>()
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        if (mask[y * dimension + x]) points += Pair(x.toDouble(), y.toDouble())
      }
    }
    if (points.size < 8) return 0.0
    val centerX = points.sumOf { it.first } / points.size.toDouble()
    val centerY = points.sumOf { it.second } / points.size.toDouble()
    var xx = 0.0
    var yy = 0.0
    var xy = 0.0
    points.forEach { (x, y) ->
      val dx = x - centerX
      val dy = y - centerY
      xx += dx * dx
      yy += dy * dy
      xy += dx * dy
    }
    xx /= points.size.toDouble()
    yy /= points.size.toDouble()
    xy /= points.size.toDouble()
    val trace = xx + yy
    val detPart = kotlin.math.sqrt(((xx - yy) * (xx - yy)) + (4.0 * xy * xy))
    val lambda1 = ((trace + detPart) / 2.0).coerceAtLeast(1e-6)
    val lambda2 = ((trace - detPart) / 2.0).coerceAtLeast(1e-6)
    val angle = 0.5 * kotlin.math.atan2(2.0 * xy, xx - yy)
    val cosA = kotlin.math.cos(angle)
    val sinA = kotlin.math.sin(angle)
    val radiusError = points.map { (x, y) ->
      val dx = x - centerX
      val dy = y - centerY
      val rx = (dx * cosA) + (dy * sinA)
      val ry = (-dx * sinA) + (dy * cosA)
      kotlin.math.abs(((rx * rx) / lambda1) + ((ry * ry) / lambda2) - 1.0)
    }.average()
    return (1.0 - radiusError.coerceAtMost(1.0)).coerceIn(0.0, 1.0)
  }

  private fun contourCornerCount(turnProfile: DoubleArray): Int {
    if (turnProfile.size < 3) return 0
    val threshold = (turnProfile.average() + 0.18).coerceAtMost(0.82)
    var count = 0
    for (index in turnProfile.indices) {
      val prev = turnProfile[(index - 1 + turnProfile.size) % turnProfile.size]
      val current = turnProfile[index]
      val next = turnProfile[(index + 1) % turnProfile.size]
      if (current >= threshold && current >= prev && current >= next) count += 1
    }
    return count
  }

  private fun diagonalDominance(mask: BooleanArray, dimension: Int): Double {
    val diagonal = (mainDiagonalProfile(mask, dimension).average() + antiDiagonalProfile(mask, dimension).average()) / 2.0
    val orth = (
      rowActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble() +
        columnActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
      ) / 2.0
    return (diagonal - orth).coerceIn(-1.0, 1.0)
  }

  private fun orthogonalDominance(
    mask: BooleanArray,
    outerContourProfile: DoubleArray,
    dimension: Int,
  ): Double {
    val centerRow = rowActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val centerCol = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val diagonal = (mainDiagonalProfile(mask, dimension).average() + antiDiagonalProfile(mask, dimension).average()) / 2.0
    val bucket0 = outerContourProfile.getOrElse(0) { 0.0 }
    val bucket8 = outerContourProfile.getOrElse(8) { 0.0 }
    val bucket16 = outerContourProfile.getOrElse(16) { 0.0 }
    val bucket24 = outerContourProfile.getOrElse(24) { 0.0 }
    val axisStrength = (bucket0 + bucket8 + bucket16 + bucket24) / 4.0
    return (((centerRow + centerCol) / 2.0) + axisStrength - diagonal).coerceIn(-1.0, 1.0)
  }

  private fun diamondCornerLayoutScore(outlineMask: BooleanArray, dimension: Int): Double {
    val points = outlinePoints(outlineMask, dimension)
    if (points.isEmpty()) return 0.0
    val centerX = (dimension - 1) / 2.0
    val centerY = (dimension - 1) / 2.0
    val top = points.minByOrNull { it.second } ?: return 0.0
    val bottom = points.maxByOrNull { it.second } ?: return 0.0
    val left = points.minByOrNull { it.first } ?: return 0.0
    val right = points.maxByOrNull { it.first } ?: return 0.0
    val horizontalCentering =
      1.0 - ((kotlin.math.abs(top.first - centerX) + kotlin.math.abs(bottom.first - centerX)) / max(1.0, dimension.toDouble()))
    val verticalCentering =
      1.0 - ((kotlin.math.abs(left.second - centerY) + kotlin.math.abs(right.second - centerY)) / max(1.0, dimension.toDouble()))
    val verticalBalance =
      1.0 - (kotlin.math.abs((centerY - top.second) - (bottom.second - centerY)) / max(1.0, dimension.toDouble()))
    val horizontalBalance =
      1.0 - (kotlin.math.abs((centerX - left.first) - (right.first - centerX)) / max(1.0, dimension.toDouble()))
    return ((horizontalCentering + verticalCentering + verticalBalance + horizontalBalance) / 4.0).coerceIn(0.0, 1.0)
  }

  private fun diamondDiagonalEdgeScore(outlineMask: BooleanArray, dimension: Int): Double {
    val points = outlinePoints(outlineMask, dimension)
    if (points.isEmpty()) return 0.0
    val top = points.minByOrNull { it.second } ?: return 0.0
    val bottom = points.maxByOrNull { it.second } ?: return 0.0
    val left = points.minByOrNull { it.first } ?: return 0.0
    val right = points.maxByOrNull { it.first } ?: return 0.0
    val support = listOf(
      lineSupport(outlineMask, dimension, top, right),
      lineSupport(outlineMask, dimension, right, bottom),
      lineSupport(outlineMask, dimension, bottom, left),
      lineSupport(outlineMask, dimension, left, top),
    )
    return support.average().coerceIn(0.0, 1.0)
  }

  private fun buildOuterShapePointCloud(
    mask: BooleanArray,
    outlineMask: BooleanArray,
    dimension: Int,
  ): List<CloudPoint> {
    val radialPoints = extractOuterBoundaryPoints(mask, outlineMask, dimension)
    val sourcePoints = if (radialPoints.size >= 12) {
      radialPoints
    } else {
      outlinePoints(outlineMask, dimension)
        .sortedBy { (x, y) ->
          kotlin.math.atan2(
            y - ((dimension - 1) / 2.0),
            x - ((dimension - 1) / 2.0),
          )
        }
        .map { (x, y) -> CloudPoint(x.toDouble(), y.toDouble()) }
    }
    if (sourcePoints.size < 4) return emptyList()
    val resampled = resampleClosedPointCloud(sourcePoints, POINT_CLOUD_SIZE)
    return normalizePointCloud(resampled)
  }

  private fun extractOuterBoundaryPoints(
    mask: BooleanArray,
    outlineMask: BooleanArray,
    dimension: Int,
  ): List<CloudPoint> {
    val points = mutableListOf<CloudPoint>()
    val center = (dimension - 1) / 2.0
    val maxRadius = kotlin.math.hypot(center, center)
    for (bucket in 0 until OUTER_BOUNDARY_SAMPLE_COUNT) {
      val angle = (kotlin.math.PI * 2.0 * bucket.toDouble()) / OUTER_BOUNDARY_SAMPLE_COUNT.toDouble()
      val cosTheta = kotlin.math.cos(angle)
      val sinTheta = kotlin.math.sin(angle)
      var hitX = -1
      var hitY = -1
      var radius = maxRadius
      while (radius >= dimension * 0.16) {
        val x = (center + (cosTheta * radius)).toInt().coerceIn(0, dimension - 1)
        val y = (center + (sinTheta * radius)).toInt().coerceIn(0, dimension - 1)
        val index = y * dimension + x
        if (outlineMask.getOrNull(index) == true || mask.getOrNull(index) == true) {
          hitX = x
          hitY = y
          break
        }
        radius -= 0.75
      }
      if (hitX >= 0 && hitY >= 0) {
        val last = points.lastOrNull()
        if (last == null || last.x != hitX.toDouble() || last.y != hitY.toDouble()) {
          points += CloudPoint(hitX.toDouble(), hitY.toDouble())
        }
      }
    }
    if (points.size >= 2 && points.first().x == points.last().x && points.first().y == points.last().y) {
      points.removeLast()
    }
    return points
  }

  private fun resampleClosedPointCloud(points: List<CloudPoint>, targetCount: Int): List<CloudPoint> {
    if (points.isEmpty()) return emptyList()
    if (points.size == 1) return List(targetCount) { points.first() }
    val closed = if (points.first() == points.last()) points else points + points.first()
    val segmentLengths = DoubleArray(closed.size - 1)
    var totalLength = 0.0
    for (index in 0 until closed.size - 1) {
      val length = pointDistance(closed[index], closed[index + 1])
      segmentLengths[index] = length
      totalLength += length
    }
    if (totalLength <= 1e-6) return List(targetCount) { closed.first() }
    val step = totalLength / targetCount.toDouble()
    val result = mutableListOf<CloudPoint>()
    var currentSegment = 0
    var segmentStart = closed[0]
    var segmentEnd = closed[1]
    var accumulated = 0.0
    var distanceIntoSegment = 0.0
    for (sampleIndex in 0 until targetCount) {
      val targetDistance = sampleIndex * step
      while (currentSegment < segmentLengths.size - 1 && accumulated + segmentLengths[currentSegment] < targetDistance) {
        accumulated += segmentLengths[currentSegment]
        currentSegment += 1
        segmentStart = closed[currentSegment]
        segmentEnd = closed[currentSegment + 1]
        distanceIntoSegment = 0.0
      }
      val segmentLength = segmentLengths[currentSegment].coerceAtLeast(1e-6)
      val remaining = (targetDistance - accumulated).coerceIn(0.0, segmentLength)
      val t = remaining / segmentLength
      result += CloudPoint(
        x = segmentStart.x + ((segmentEnd.x - segmentStart.x) * t),
        y = segmentStart.y + ((segmentEnd.y - segmentStart.y) * t),
      )
    }
    return result
  }

  private fun normalizePointCloud(points: List<CloudPoint>): List<CloudPoint> {
    if (points.isEmpty()) return emptyList()
    val centroidX = points.map { it.x }.average()
    val centroidY = points.map { it.y }.average()
    val translated = points.map { CloudPoint(it.x - centroidX, it.y - centroidY, it.id) }
    val minX = translated.minOf { it.x }
    val maxX = translated.maxOf { it.x }
    val minY = translated.minOf { it.y }
    val maxY = translated.maxOf { it.y }
    val scale = max(maxX - minX, maxY - minY).coerceAtLeast(1e-6)
    return translated.map {
      CloudPoint(
        x = it.x / scale,
        y = it.y / scale,
        id = it.id,
      )
    }
  }

  private fun comparePointClouds(observed: List<CloudPoint>, template: List<CloudPoint>): Double {
    if (observed.isEmpty() || template.isEmpty()) return 0.0
    val distance = greedyCloudMatch(observed, template)
    val normalized = (1.0 - (distance / 4.0)).coerceIn(0.0, 1.0)
    return normalized
  }

  private fun buildShapeGeometryMetrics(
    observedMask: BooleanArray,
    observedOutlineMask: BooleanArray,
    observedPointCloud: List<CloudPoint>,
    contourMetrics: ContourMetrics,
    triangleBoundaryMetrics: TriangleBoundaryMetrics,
    openCvContourResult: OpenCvContourResult?,
    dimension: Int,
  ): ShapeGeometryMetrics {
    val bounds = maskBounds(observedMask, dimension)
    val minX = bounds?.getOrNull(0) ?: 0
    val minY = bounds?.getOrNull(1) ?: 0
    val maxX = bounds?.getOrNull(2) ?: (dimension - 1)
    val maxY = bounds?.getOrNull(3) ?: (dimension - 1)
    val width = (maxX - minX + 1).coerceAtLeast(1)
    val height = (maxY - minY + 1).coerceAtLeast(1)
    val aspectRatio = max(width, height).toDouble() / max(1, minOf(width, height)).toDouble()
    val area = observedMask.count { it }
    val extent = area.toDouble() / max(1, width * height).toDouble()
    val centerRow = rowActiveCount(observedMask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val centerCol = columnActiveCount(observedMask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val centerBarStrength = (centerRow + centerCol) / 2.0
    val polygon = approximatePolygon(observedPointCloud, 0.02)
    return ShapeGeometryMetrics(
      vertices = openCvContourResult?.vertices ?: if (polygon.isNotEmpty()) polygon.size else contourMetrics.smoothedCornerCount.coerceAtLeast(contourMetrics.cornerCount),
      aspectRatio = openCvContourResult?.aspectRatio ?: aspectRatio,
      extent = openCvContourResult?.extent ?: extent.coerceIn(0.0, 1.0),
      circularity = maxOf(
        openCvContourResult?.circularity ?: 0.0,
        contourMetrics.circularity,
        contourMetrics.smoothedCircularity,
      ).coerceIn(0.0, 1.0),
      diagonalDominance = contourMetrics.diagonalDominance,
      orthogonalDominance = contourMetrics.smoothedOrthogonalDominance,
      centerBarStrength = centerBarStrength,
      asymmetry = arrowLikeAsymmetry(observedMask, dimension),
      triangleScore = triangleBoundaryMetrics.score,
      apexNarrowness = triangleBoundaryMetrics.apexNarrowness,
      tailSupport = triangleBoundaryMetrics.tailSupport,
      diamondCornerScore = diamondCornerLayoutScore(observedOutlineMask, dimension),
      diamondDiagonalScore = diamondDiagonalEdgeScore(observedOutlineMask, dimension),
    )
  }

  private fun scoreShapeGeometry(shapeName: String, metrics: ShapeGeometryMetrics): Double {
    fun closeness(value: Double, target: Double, tolerance: Double): Double {
      if (tolerance <= 1e-6) return if (kotlin.math.abs(value - target) <= 1e-6) 1.0 else 0.0
      return (1.0 - (kotlin.math.abs(value - target) / tolerance)).coerceIn(0.0, 1.0)
    }

    fun lowScore(value: Double, floor: Double, ceiling: Double): Double {
      if (value <= floor) return 1.0
      if (value >= ceiling) return 0.0
      return 1.0 - ((value - floor) / (ceiling - floor))
    }

    return when (shapeName) {
      "Circle" -> {
        if (
          metrics.circularity < 0.45 ||
          metrics.aspectRatio > 1.22 ||
          metrics.centerBarStrength > 0.42 ||
          metrics.orthogonalDominance > 0.55
        ) {
          return 0.0
        }
        var score =
          (closeness(metrics.circularity, 0.78, 0.20) * 0.34) +
            (closeness(metrics.aspectRatio, 1.0, 0.18) * 0.18) +
            (closeness(metrics.extent, 0.78, 0.18) * 0.16) +
            (lowScore(metrics.vertices.toDouble(), 5.0, 9.0) * 0.10) +
            (lowScore(metrics.orthogonalDominance, 0.18, 0.58) * 0.10) +
            (lowScore(kotlin.math.abs(metrics.diagonalDominance), 0.10, 0.48) * 0.06) +
            (lowScore(metrics.centerBarStrength, 0.18, 0.42) * 0.06)
        if (metrics.circularity < 0.45) score -= 0.28
        if (metrics.aspectRatio > 1.22) score -= 0.26
        if (metrics.centerBarStrength > 0.42) score -= 0.18
        if (metrics.orthogonalDominance > 0.55) score -= 0.14
        score.coerceIn(0.0, 1.0)
      }
      "Square" -> (
        (closeness(metrics.vertices.toDouble(), 4.0, 1.6) * 0.22) +
          (closeness(metrics.extent, 0.78, 0.20) * 0.22) +
          (closeness(metrics.aspectRatio, 1.0, 0.18) * 0.18) +
          (closeness(metrics.orthogonalDominance, 1.0, 0.45) * 0.28) +
          (lowScore(metrics.diamondDiagonalScore, 0.28, 0.72) * 0.10)
        ).coerceIn(0.0, 1.0)
      "Diamond" -> (
        if (
          metrics.centerBarStrength >= 0.50 &&
          metrics.orthogonalDominance >= 0.70 &&
          metrics.aspectRatio >= 1.35 &&
          metrics.circularity <= 0.30
        ) {
          0.0
        } else {
          (
            (closeness(metrics.vertices.toDouble(), 4.0, 1.6) * 0.18) +
              (closeness(metrics.aspectRatio, 1.0, 0.18) * 0.14) +
              (closeness(metrics.extent, 0.50, 0.18) * 0.18) +
              (closeness(metrics.diamondDiagonalScore, 0.78, 0.32) * 0.20) +
              (closeness(metrics.diamondCornerScore, 0.85, 0.30) * 0.18) +
              (lowScore(metrics.orthogonalDominance, 0.22, 0.78) * 0.12) -
              (closeness(metrics.centerBarStrength, 0.60, 0.22) * 0.16) -
              (closeness(metrics.orthogonalDominance, 0.82, 0.16) * 0.14) -
              (closeness(metrics.aspectRatio, 1.65, 0.35) * 0.10)
          ).coerceIn(0.0, 1.0)
        }
      )
      "Triangle" -> (
        (closeness(metrics.vertices.toDouble(), 3.0, 1.4) * 0.26) +
          (closeness(metrics.extent, 0.60, 0.18) * 0.14) +
          (closeness(metrics.aspectRatio, 1.15, 0.28) * 0.12) +
          (closeness(metrics.diagonalDominance, 0.50, 0.32) * 0.12) +
          (closeness(metrics.triangleScore, 0.70, 0.35) * 0.20) +
          (closeness(metrics.apexNarrowness, 0.55, 0.35) * 0.08) +
          (closeness(metrics.tailSupport, 0.75, 0.30) * 0.08)
        ).coerceIn(0.0, 1.0)
      "Arrow" -> (
        (closeness(metrics.vertices.toDouble(), 7.0, 3.0) * 0.18) +
          (lowScore(metrics.circularity, 0.24, 0.62) * 0.14) +
          (closeness(metrics.aspectRatio, 1.30, 0.35) * 0.18) +
          (closeness(metrics.extent, 0.60, 0.18) * 0.12) +
          (closeness(metrics.asymmetry, 0.22, 0.20) * 0.24) +
          (lowScore(metrics.centerBarStrength, 0.18, 0.55) * 0.14)
        ).coerceIn(0.0, 1.0)
      "Cross" -> (
        (
          (closeness(metrics.vertices.toDouble(), 12.0, 7.0) * 0.10) +
            (lowScore(metrics.circularity, 0.24, 0.62) * 0.12) +
            (closeness(metrics.aspectRatio, 1.0, 0.75) * 0.10) +
            (closeness(metrics.extent, 0.55, 0.20) * 0.12) +
            (closeness(metrics.orthogonalDominance, 0.95, 0.40) * 0.22) +
            (closeness(metrics.centerBarStrength, 0.60, 0.28) * 0.24) +
            (lowScore(metrics.diamondDiagonalScore, 0.25, 0.70) * 0.10) +
            (closeness(metrics.aspectRatio, 1.65, 0.35) * 0.10) +
            (if (
              metrics.centerBarStrength >= 0.50 &&
              metrics.orthogonalDominance >= 0.70 &&
              metrics.aspectRatio >= 1.35 &&
              metrics.circularity <= 0.30
            ) 0.20 else 0.0)
          ).coerceIn(0.0, 1.0)
      )
      else -> 0.0
    }
  }

  private fun maskBounds(mask: BooleanArray, dimension: Int): IntArray? {
    var minX = dimension
    var minY = dimension
    var maxX = -1
    var maxY = -1
    for (index in mask.indices) {
      if (!mask[index]) continue
      val x = index % dimension
      val y = index / dimension
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return if (maxX < 0 || maxY < 0) null else intArrayOf(minX, minY, maxX, maxY)
  }

  private fun greedyCloudMatch(pointsA: List<CloudPoint>, pointsB: List<CloudPoint>): Double {
    val count = minOf(pointsA.size, pointsB.size)
    if (count == 0) return Double.MAX_VALUE
    val step = kotlin.math.max(1, kotlin.math.floor(kotlin.math.sqrt(count.toDouble())).toInt())
    var minDistance = Double.MAX_VALUE
    for (start in 0 until count step step) {
      minDistance = minOf(minDistance, cloudDistance(pointsA, pointsB, start))
      minDistance = minOf(minDistance, cloudDistance(pointsB, pointsA, start))
    }
    return minDistance / count.toDouble()
  }

  private fun cloudDistance(pointsA: List<CloudPoint>, pointsB: List<CloudPoint>, start: Int): Double {
    val count = minOf(pointsA.size, pointsB.size)
    if (count == 0) return Double.MAX_VALUE
    val matched = BooleanArray(count)
    var sum = 0.0
    var index = start % count
    repeat(count) { offset ->
      var bestDistance = Double.MAX_VALUE
      var bestIndex = -1
      for (candidate in 0 until count) {
        if (matched[candidate]) continue
        val distance = pointDistance(pointsA[index], pointsB[candidate])
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = candidate
        }
      }
      if (bestIndex >= 0) {
        matched[bestIndex] = true
        val weight = 1.0 - (offset.toDouble() / count.toDouble())
        sum += bestDistance * weight
      }
      index = (index + 1) % count
    }
    return sum
  }

  private fun pointDistance(a: CloudPoint, b: CloudPoint): Double {
    return kotlin.math.hypot(a.x - b.x, a.y - b.y)
  }

  private fun approximatePolygon(points: List<CloudPoint>, epsilonRatio: Double): List<CloudPoint> {
    if (points.size < 3) return points
    val closed = if (points.first() == points.last()) points else points + points.first()
    val perimeter = closed.zipWithNext().sumOf { (a, b) -> pointDistance(a, b) }.coerceAtLeast(1e-6)
    val epsilon = perimeter * epsilonRatio
    val simplified = ramerDouglasPeucker(closed.dropLast(1), epsilon)
    return if (simplified.size >= 2 && simplified.first() == simplified.last()) simplified.dropLast(1) else simplified
  }

  private fun ramerDouglasPeucker(points: List<CloudPoint>, epsilon: Double): List<CloudPoint> {
    if (points.size < 3) return points
    val first = points.first()
    val last = points.last()
    var maxDistance = 0.0
    var index = -1
    for (i in 1 until points.lastIndex) {
      val distance = perpendicularDistance(points[i], first, last)
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (maxDistance <= epsilon || index < 0) return listOf(first, last)
    val left = ramerDouglasPeucker(points.subList(0, index + 1), epsilon)
    val right = ramerDouglasPeucker(points.subList(index, points.size), epsilon)
    return left.dropLast(1) + right
  }

  private fun perpendicularDistance(point: CloudPoint, lineStart: CloudPoint, lineEnd: CloudPoint): Double {
    val dx = lineEnd.x - lineStart.x
    val dy = lineEnd.y - lineStart.y
    if (kotlin.math.abs(dx) <= 1e-6 && kotlin.math.abs(dy) <= 1e-6) return pointDistance(point, lineStart)
    val numerator = kotlin.math.abs((dy * point.x) - (dx * point.y) + (lineEnd.x * lineStart.y) - (lineEnd.y * lineStart.x))
    val denominator = kotlin.math.hypot(dx, dy).coerceAtLeast(1e-6)
    return numerator / denominator
  }

  private fun crossOrthogonalPenalty(mask: BooleanArray, dimension: Int): Double {
    val centerRow = rowActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val centerCol = columnActiveCount(mask, dimension, (dimension * 0.50f).toInt()).toDouble() / max(1, dimension).toDouble()
    val upperRow = rowActiveCount(mask, dimension, (dimension * 0.28f).toInt()).toDouble() / max(1, dimension).toDouble()
    val lowerRow = rowActiveCount(mask, dimension, (dimension * 0.72f).toInt()).toDouble() / max(1, dimension).toDouble()
    val leftCol = columnActiveCount(mask, dimension, (dimension * 0.28f).toInt()).toDouble() / max(1, dimension).toDouble()
    val rightCol = columnActiveCount(mask, dimension, (dimension * 0.72f).toInt()).toDouble() / max(1, dimension).toDouble()
    val rowDominance = centerRow - ((upperRow + lowerRow) / 2.0)
    val colDominance = centerCol - ((leftCol + rightCol) / 2.0)
    return ((rowDominance + colDominance) / 2.0).coerceIn(0.0, 1.0)
  }

  private fun outlinePoints(outlineMask: BooleanArray, dimension: Int): List<Pair<Int, Int>> {
    val points = mutableListOf<Pair<Int, Int>>()
    for (index in outlineMask.indices) {
      if (!outlineMask[index]) continue
      points += Pair(index % dimension, index / dimension)
    }
    return points
  }

  private fun lineSupport(
    outlineMask: BooleanArray,
    dimension: Int,
    start: Pair<Int, Int>,
    end: Pair<Int, Int>,
  ): Double {
    val dx = end.first - start.first
    val dy = end.second - start.second
    val steps = max(1, max(kotlin.math.abs(dx), kotlin.math.abs(dy)))
    var hits = 0
    for (step in 0..steps) {
      val t = step.toDouble() / steps.toDouble()
      val x = kotlin.math.round(start.first + (dx * t)).toInt().coerceIn(0, dimension - 1)
      val y = kotlin.math.round(start.second + (dy * t)).toInt().coerceIn(0, dimension - 1)
      if (outlineMask[y * dimension + x]) {
        hits += 1
        continue
      }
      var nearHit = false
      for (oy in -1..1) {
        for (ox in -1..1) {
          val nx = (x + ox).coerceIn(0, dimension - 1)
          val ny = (y + oy).coerceIn(0, dimension - 1)
          if (outlineMask[ny * dimension + nx]) {
            nearHit = true
            break
          }
        }
        if (nearHit) break
      }
      if (nearHit) hits += 1
    }
    return hits.toDouble() / (steps + 1).toDouble()
  }

  private fun normalizeSetSymbolMask(mask: BooleanArray, dimension: Int, profile: String): BooleanArray {
    val trimmed = when (profile) {
      "arrow" -> trimOuterMask(mask, dimension, 0.22f)
      "triangle" -> trimOuterMask(mask, dimension, 0.22f)
      else -> trimOuterMask(mask, dimension, 0.20f)
    }

    val windowed = trimmed.copyOf()
    for (y in 0 until dimension) {
      for (x in 0 until dimension) {
        val keep = when (profile) {
          "arrow" -> isWithinArrowGlyphWindow(x, y, dimension)
          "triangle" -> isWithinTriangleGlyphWindow(x, y, dimension)
          else -> isWithinGenericGlyphWindow(x, y, dimension)
        }
        if (!keep) {
          windowed[y * dimension + x] = false
        }
      }
    }

    return when (profile) {
      "arrow" -> recenterAndScaleMask(windowed, dimension, 0.92)
      "triangle" -> recenterAndScaleMask(isolateCentralSymbol(windowed, dimension), dimension, 0.72)
      else -> recenterAndScaleMask(isolateCentralSymbol(windowed, dimension), dimension, 0.68)
    }
  }

  private fun isWithinArrowGlyphWindow(x: Int, y: Int, dimension: Int): Boolean {
    val left = dimension * 0.16
    val right = dimension * 0.72
    val top = dimension * 0.08
    val bottom = dimension * 0.76
    val centerX = dimension * 0.40
    val centerY = dimension * 0.44
    val radiusX = max(1.0, dimension * 0.28)
    val radiusY = max(1.0, dimension * 0.30)
    val dx = (x - centerX) / radiusX
    val dy = (y - centerY) / radiusY
    val ellipse = ((dx * dx) + (dy * dy)) <= 1.0
    val box = x >= left && x <= right && y >= top && y <= bottom
    val centerCore = x >= dimension * 0.14 && x <= dimension * 0.62 && y >= dimension * 0.14 && y <= dimension * 0.70
    return ellipse || box || centerCore
  }

  private fun recenterAndScaleMask(mask: BooleanArray, dimension: Int, targetFillRatio: Double): BooleanArray {
    return recenterAndScaleMask(mask, dimension, dimension, dimension, targetFillRatio)
  }

  private fun recenterAndScaleMask(
    mask: BooleanArray,
    sourceWidth: Int,
    sourceHeight: Int,
    targetDimension: Int,
    targetFillRatio: Double,
  ): BooleanArray {
    if (sourceWidth <= 0 || sourceHeight <= 0) return BooleanArray(targetDimension * targetDimension)
    if (mask.size < sourceWidth * sourceHeight) return BooleanArray(targetDimension * targetDimension)
    val indices = mask.indices.filter { mask[it] }
    if (indices.isEmpty()) return BooleanArray(targetDimension * targetDimension)

    var minX = sourceWidth
    var maxX = -1
    var minY = sourceHeight
    var maxY = -1
    indices.forEach { index ->
      val x = index % sourceWidth
      val y = index / sourceWidth
      if (y !in 0 until sourceHeight) return@forEach
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    val bboxWidth = (maxX - minX + 1).coerceAtLeast(1)
    val bboxHeight = (maxY - minY + 1).coerceAtLeast(1)
    val targetMaxDimension = (targetDimension * targetFillRatio).toInt().coerceAtLeast(1)
    // Scale to fit bbox into targetFillRatio of canvas. Allow shrinking (scale<1)
    // when source bbox is larger than the target — previously coerced to >=1.0
    // which cropped oversized masks to the canvas edges instead of scaling them.
    val scale = minOf(
      targetMaxDimension.toDouble() / bboxWidth.toDouble(),
      targetMaxDimension.toDouble() / bboxHeight.toDouble(),
    ).coerceAtLeast(0.01)

    val scaledWidth = (bboxWidth * scale).toInt().coerceAtLeast(1).coerceAtMost(targetDimension)
    val scaledHeight = (bboxHeight * scale).toInt().coerceAtLeast(1).coerceAtMost(targetDimension)
    val offsetX = ((targetDimension - scaledWidth) / 2.0).toInt()
    val offsetY = ((targetDimension - scaledHeight) / 2.0).toInt()
    val output = BooleanArray(targetDimension * targetDimension)

    for (y in 0 until scaledHeight) {
      for (x in 0 until scaledWidth) {
        val sourceX = (x / scale).toInt().coerceIn(0, bboxWidth - 1) + minX
        val sourceY = (y / scale).toInt().coerceIn(0, bboxHeight - 1) + minY
        if (!mask[sourceY * sourceWidth + sourceX]) continue
        val destX = (offsetX + x).coerceIn(0, targetDimension - 1)
        val destY = (offsetY + y).coerceIn(0, targetDimension - 1)
        output[destY * targetDimension + destX] = true
      }
    }

    return output
  }

  private fun isWithinTriangleGlyphWindow(x: Int, y: Int, dimension: Int): Boolean {
    val left = dimension * 0.24
    val right = dimension * 0.76
    val top = dimension * 0.18
    val bottom = dimension * 0.78
    return x >= left && x <= right && y >= top && y <= bottom
  }

  private fun isWithinGenericGlyphWindow(x: Int, y: Int, dimension: Int): Boolean {
    val left = dimension * 0.22
    val right = dimension * 0.78
    val top = dimension * 0.20
    val bottom = dimension * 0.82
    return x >= left && x <= right && y >= top && y <= bottom
  }

  private fun isolateCentralSymbol(mask: BooleanArray, dimension: Int): BooleanArray {
    val visited = BooleanArray(mask.size)
    val queue = ArrayDeque<Int>()
    val centerX = (dimension - 1) / 2.0
    val centerY = dimension * 0.56
    data class ComponentSummary(
      val pixels: List<Int>,
      val count: Double,
      val centroidX: Double,
      val centroidY: Double,
      val minX: Int,
      val maxX: Int,
      val minY: Int,
      val maxY: Int,
      val distance: Double,
      val score: Double,
    )

    val components = mutableListOf<ComponentSummary>()

    for (index in mask.indices) {
      if (!mask[index] || visited[index]) continue

      val component = mutableListOf<Int>()
      var minX = dimension
      var maxX = -1
      var minY = dimension
      var maxY = -1
      var sumX = 0.0
      var sumY = 0.0

      visited[index] = true
      queue.add(index)

      while (queue.isNotEmpty()) {
        val current = queue.removeFirst()
        component += current
        val x = current % dimension
        val y = current / dimension
        sumX += x
        sumY += y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y

        val neighbors = intArrayOf(
          current - 1,
          current + 1,
          current - dimension,
          current + dimension,
        )
        neighbors.forEach { neighbor ->
          if (neighbor !in mask.indices || visited[neighbor] || !mask[neighbor]) return@forEach
          val nx = neighbor % dimension
          val ny = neighbor / dimension
          if (kotlin.math.abs(nx - x) + kotlin.math.abs(ny - y) != 1) return@forEach
          visited[neighbor] = true
          queue.add(neighbor)
        }
      }

      val count = component.size.toDouble()
      if (count <= 0.0) continue
      val centroidX = sumX / count
      val centroidY = sumY / count
      val distance = kotlin.math.sqrt(
        ((centroidX - centerX) * (centroidX - centerX)) +
          ((centroidY - centerY) * (centroidY - centerY))
      )
      val bboxWidth = (maxX - minX + 1).coerceAtLeast(1)
      val bboxHeight = (maxY - minY + 1).coerceAtLeast(1)
      val aspectPenalty = kotlin.math.abs(bboxWidth - bboxHeight).toDouble() / max(1, dimension).toDouble()
      val score = count - (distance * 2.2) - (aspectPenalty * 8.0)
      components += ComponentSummary(
        pixels = component.toList(),
        count = count,
        centroidX = centroidX,
        centroidY = centroidY,
        minX = minX,
        maxX = maxX,
        minY = minY,
        maxY = maxY,
        distance = distance,
        score = score,
      )
    }

    val primary = components.maxByOrNull { it.score } ?: return mask
    val keepMask = BooleanArray(mask.size)
    val centralWindowLeft = (dimension * 0.22f).toInt()
    val centralWindowRight = (dimension * 0.78f).toInt()
    val centralWindowTop = (dimension * 0.24f).toInt()
    val centralWindowBottom = (dimension * 0.86f).toInt()

    components.forEach { component ->
      val overlapsCentralWindow =
        component.maxX >= centralWindowLeft &&
          component.minX <= centralWindowRight &&
          component.maxY >= centralWindowTop &&
          component.minY <= centralWindowBottom
      val closeToPrimary =
        kotlin.math.abs(component.centroidX - primary.centroidX) <= dimension * 0.18 &&
          kotlin.math.abs(component.centroidY - primary.centroidY) <= dimension * 0.22
      val substantial =
        component.count >= max(6.0, primary.count * 0.10)
      val competitive =
        component.score >= (primary.score - max(6.0, primary.count * 0.22))

      if (
        component == primary ||
        (overlapsCentralWindow && closeToPrimary && substantial && competitive)
      ) {
        component.pixels.forEach { keepMask[it] = true }
      }
    }

    return if (keepMask.any { it }) keepMask else mask
  }

  private fun isolateOuterShape(mask: BooleanArray, dimension: Int): BooleanArray {
    val visited = BooleanArray(mask.size)
    val queue = ArrayDeque<Int>()
    data class ComponentSummary(
      val pixels: List<Int>,
      val count: Int,
      val centroidX: Double,
      val centroidY: Double,
      val minX: Int,
      val maxX: Int,
      val minY: Int,
      val maxY: Int,
    )

    val components = mutableListOf<ComponentSummary>()
    var totalX = 0.0
    var totalY = 0.0
    var totalCount = 0

    for (index in mask.indices) {
      if (!mask[index] || visited[index]) continue

      val component = mutableListOf<Int>()
      var minX = dimension
      var maxX = -1
      var minY = dimension
      var maxY = -1
      var sumX = 0.0
      var sumY = 0.0

      visited[index] = true
      queue.add(index)

      while (queue.isNotEmpty()) {
        val current = queue.removeFirst()
        component += current
        val x = current % dimension
        val y = current / dimension
        sumX += x
        sumY += y
        totalX += x
        totalY += y
        totalCount += 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y

        val neighbors = intArrayOf(
          current - 1,
          current + 1,
          current - dimension,
          current + dimension,
        )
        neighbors.forEach { neighbor ->
          if (neighbor !in mask.indices || visited[neighbor] || !mask[neighbor]) return@forEach
          val nx = neighbor % dimension
          val ny = neighbor / dimension
          if (kotlin.math.abs(nx - x) + kotlin.math.abs(ny - y) != 1) return@forEach
          visited[neighbor] = true
          queue.add(neighbor)
        }
      }

      val count = component.size
      if (count == 0) continue
      components += ComponentSummary(
        pixels = component.toList(),
        count = count,
        centroidX = sumX / count.toDouble(),
        centroidY = sumY / count.toDouble(),
        minX = minX,
        maxX = maxX,
        minY = minY,
        maxY = maxY,
      )
    }

    if (components.isEmpty()) return mask
    val overallCentroidX = totalX / totalCount.toDouble()
    val overallCentroidY = totalY / totalCount.toDouble()
    val largest = components.maxOf { it.count }
    val keepMask = BooleanArray(mask.size)
    val keepMinCount = max(10, (largest * 0.18).toInt())
    val badgeLeft = (dimension * 0.12f).toInt()
    val badgeRight = (dimension * 0.88f).toInt()
    val badgeTop = (dimension * 0.08f).toInt()
    val badgeBottom = (dimension * 0.90f).toInt()

    components.forEach { component ->
      val overlapsBadgeWindow =
        component.maxX >= badgeLeft &&
          component.minX <= badgeRight &&
          component.maxY >= badgeTop &&
          component.minY <= badgeBottom
      val nearOverallCenter =
        kotlin.math.abs(component.centroidX - overallCentroidX) <= dimension * 0.26 &&
          kotlin.math.abs(component.centroidY - overallCentroidY) <= dimension * 0.26
      if (component.count >= keepMinCount && overlapsBadgeWindow && nearOverallCenter) {
        component.pixels.forEach { keepMask[it] = true }
      }
    }

    return if (keepMask.any { it }) keepMask else mask
  }

  private fun isWithinSetBadgeWindow(x: Int, y: Int, dimension: Int): Boolean {
    val weight = setBadgeWeight(x, y, dimension)
    return weight >= 0.22
  }

  private fun setBadgeWeight(x: Int, y: Int, dimension: Int): Double {
    val centerX = (dimension - 1) * 0.50
    val centerY = (dimension - 1) * 0.56
    val radiusX = max(1.0, dimension * 0.30)
    val radiusY = max(1.0, dimension * 0.27)
    val dx = (x - centerX) / radiusX
    val dy = (y - centerY) / radiusY
    val ellipseDistance = kotlin.math.sqrt((dx * dx) + (dy * dy))
    val ellipseWeight = (1.0 - ellipseDistance).coerceIn(0.0, 1.0)

    val boxLeft = dimension * 0.24
    val boxRight = dimension * 0.76
    val boxTop = dimension * 0.28
    val boxBottom = dimension * 0.86
    val inCenterBox = x >= boxLeft && x <= boxRight && y >= boxTop && y <= boxBottom

    return if (inCenterBox) {
      max(ellipseWeight, 0.45)
    } else {
      ellipseWeight
    }
  }

  private fun centerWeight(x: Int, y: Int, dimension: Int): Double {
    val center = (dimension - 1) / 2.0
    val dx = (x - center) / max(1.0, center)
    val dy = (y - center) / max(1.0, center)
    val distance = kotlin.math.sqrt((dx * dx) + (dy * dy))
    return (1.0 - distance).coerceIn(0.0, 1.0)
  }

  private fun localEdgeContrast(bitmap: Bitmap, x: Int, y: Int, dimension: Int): Int {
    val center = luminance(bitmap.getPixel(x, y))
    val neighbors = mutableListOf<Int>()
    if (x > 0) neighbors += luminance(bitmap.getPixel(x - 1, y))
    if (x < dimension - 1) neighbors += luminance(bitmap.getPixel(x + 1, y))
    if (y > 0) neighbors += luminance(bitmap.getPixel(x, y - 1))
    if (y < dimension - 1) neighbors += luminance(bitmap.getPixel(x, y + 1))
    if (neighbors.isEmpty()) return 0
    val averageNeighbor = neighbors.average()
    return kotlin.math.abs(center - averageNeighbor).toInt()
  }

  private fun compareProfiles(observed: DoubleArray, template: DoubleArray): Double {
    if (observed.isEmpty() || template.isEmpty() || observed.size != template.size) return 0.0
    var totalDifference = 0.0
    for (index in observed.indices) {
      totalDifference += kotlin.math.abs(observed[index] - template[index])
    }
    val normalizedDifference = totalDifference / observed.size.toDouble()
    return (1.0 - normalizedDifference).coerceIn(0.0, 1.0)
  }

  private fun rowFirstActive(mask: BooleanArray, dimension: Int, y: Int): Int {
    val safeY = y.coerceIn(0, dimension - 1)
    for (x in 0 until dimension) {
      if (mask[safeY * dimension + x]) return x
    }
    return -1
  }

  private fun rowLastActive(mask: BooleanArray, dimension: Int, y: Int): Int {
    val safeY = y.coerceIn(0, dimension - 1)
    for (x in dimension - 1 downTo 0) {
      if (mask[safeY * dimension + x]) return x
    }
    return -1
  }

  private fun columnFirstActive(mask: BooleanArray, dimension: Int, x: Int): Int {
    val safeX = x.coerceIn(0, dimension - 1)
    for (y in 0 until dimension) {
      if (mask[y * dimension + safeX]) return y
    }
    return -1
  }

  private fun columnLastActive(mask: BooleanArray, dimension: Int, x: Int): Int {
    val safeX = x.coerceIn(0, dimension - 1)
    for (y in dimension - 1 downTo 0) {
      if (mask[y * dimension + safeX]) return y
    }
    return -1
  }

  private fun rowActiveCount(mask: BooleanArray, dimension: Int, y: Int): Int {
    val safeY = y.coerceIn(0, dimension - 1)
    var count = 0
    for (x in 0 until dimension) {
      if (mask[safeY * dimension + x]) count += 1
    }
    return count
  }

  private fun bandActiveCount(mask: BooleanArray, dimension: Int, start: Float, end: Float, horizontal: Boolean): Int {
    val min = (dimension * start).toInt().coerceIn(0, dimension - 1)
    val maxBand = (dimension * end).toInt().coerceIn(min, dimension - 1)
    var count = 0
    if (horizontal) {
      for (y in min..maxBand) {
        for (x in 0 until dimension) {
          if (mask[y * dimension + x]) count += 1
        }
      }
    } else {
      for (x in min..maxBand) {
        for (y in 0 until dimension) {
          if (mask[y * dimension + x]) count += 1
        }
      }
    }
    return count
  }

  private fun luminance(color: Int): Int {
    val r = Color.red(color)
    val g = Color.green(color)
    val b = Color.blue(color)
    return ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)).toInt()
  }

  private fun saturation(color: Int): Float {
    val hsv = FloatArray(3)
    Color.colorToHSV(color, hsv)
    return hsv[1]
  }

  private fun isCenterRegion(x: Int, y: Int, dimension: Int): Boolean {
    val min = (dimension * 0.28f).toInt()
    val max = (dimension * 0.72f).toInt()
    return x in min..max && y in min..max
  }

  private fun isPortraitCornerRegion(x: Int, y: Int, dimension: Int): Boolean {
    val leftMax = (dimension * 0.36f).toInt()
    val bottomMin = (dimension * 0.56f).toInt()
    return x <= leftMax && y >= bottomMin
  }

  private fun isTopDotRegion(x: Int, y: Int, dimension: Int): Boolean {
    val topMax = (dimension * 0.16f).toInt()
    val leftMin = (dimension * 0.18f).toInt()
    val rightMax = (dimension * 0.82f).toInt()
    return y <= topMax && x in leftMin..rightMax
  }

  private fun shouldIgnoreShapePixel(x: Int, y: Int, dimension: Int): Boolean {
    return isCenterRegion(x, y, dimension) ||
      isPortraitCornerRegion(x, y, dimension) ||
      isTopDotRegion(x, y, dimension)
  }

  private fun shouldMuteOuterShapeFillPixel(x: Int, y: Int, dimension: Int): Boolean {
    val center = (dimension - 1) / 2.0
    val dx = (x - center) / (dimension * 0.10)
    val dy = (y - center) / (dimension * 0.10)
    return (dx * dx) + (dy * dy) <= 1.0
  }

  private fun shouldIgnoreOuterShapeFillPixel(x: Int, y: Int, dimension: Int): Boolean {
    return isPortraitCornerRegion(x, y, dimension) ||
      isTopDotRegion(x, y, dimension)
      || isOuterShapeBorderRing(x, y, dimension)
  }

  private fun shouldIgnoreOuterShapeEdgePixel(x: Int, y: Int, dimension: Int): Boolean {
    return isPortraitCornerRegion(x, y, dimension) ||
      isTopDotRegion(x, y, dimension)
      || isOuterShapeBorderRing(x, y, dimension)
  }

  private fun isOuterShapeBorderRing(x: Int, y: Int, dimension: Int): Boolean {
    val left = (dimension * 0.08f).toInt()
    val right = (dimension * 0.92f).toInt()
    val top = (dimension * 0.08f).toInt()
    val bottom = (dimension * 0.92f).toInt()
    return x < left || x > right || y < top || y > bottom
  }

    companion object {
      private const val TAG = "ModIconClassifier"
      private const val USE_SYNTHETIC_OUTER_SHAPE_PIPELINE = true
      private const val USE_SIMPLE_OUTER_SHAPE_PIPELINE = false
      private const val LEARNED_SET_ASSET_DIR = "mod-templates/learned-sets"
    private const val LEARNED_SET_MANIFEST_ASSET_PATH = "$LEARNED_SET_ASSET_DIR/manifest.json"
    private const val EXTERNAL_SET_MODEL_FILENAME = "set-classifier-model.json"
    private const val LEARNED_SET_DEBUG_FILENAME = "set-classifier-debug.json"
    private const val LEARNED_SET_RASTER_DIRNAME = "set-classifier-rasters"
    private const val ARROW_BURST_SAMPLE_FILENAME = "arrow-burst-samples.json"
    private const val ARROW_BURST_MAX_SAMPLES_PER_SET = 24
    private const val SHAPE_SAMPLE_FILENAME = "shape-samples.json"
    private const val SHAPE_SAMPLE_DIRNAME = "shape-samples"
    private const val SHAPE_CROP_EXPORT_DIRNAME = "shape-crops"
    private const val LATEST_SHAPE_OBSERVATION_FILENAME = "latest-shape-observation.json"
    private const val SHAPE_MAX_SAMPLES_PER_SET = 24
    private const val SHAPE_MAX_LEARNED_PROTOTYPES_PER_SHAPE = 3
    private const val SHAPE_LEARNED_CLUSTER_THRESHOLD = 0.94
    private const val SHAPE_SAVE_DEBUG_FILENAME = "shape-save-debug.txt"
      private const val CONTOUR_PROFILE_BUCKETS = 32
      private const val OUTER_BOUNDARY_SAMPLE_COUNT = 96
      private const val POINT_CLOUD_SIZE = 64
      private val SYNTHETIC_SHAPE_ORDER = listOf("Square", "Arrow", "Diamond", "Triangle", "Circle", "Cross")
      private val SHAPE_REFERENCE_ASSET_NAMES = linkedMapOf(
        "Square" to "mod_shapes/square_mask.png",
        "Arrow" to "mod_shapes/arrow_mask.png",
        "Diamond" to "mod_shapes/diamond_mask.png",
        "Triangle" to "mod_shapes/triangle_mask.png",
        "Circle" to "mod_shapes/circle_mask.png",
        "Cross" to "mod_shapes/cross_mask.png",
      )
      private val BUNDLED_SHAPE_PROFILES = listOf(
        BundledShapeProfile(
          name = "Triangle",
          vertices = 3..5,
          extentRange = 0.55..0.75,
          circularityRange = 0.45..0.62,
          aspectRange = 1.05..1.25,
        ),
        BundledShapeProfile(
          name = "Square",
          vertices = 4..6,
          extentRange = 0.85..1.00,
          circularityRange = 0.70..0.85,
          aspectRange = 0.92..1.08,
        ),
        BundledShapeProfile(
          name = "Arrow",
          vertices = 5..7,
          extentRange = 0.65..0.82,
          circularityRange = 0.52..0.70,
          aspectRange = 1.00..1.25,
        ),
        BundledShapeProfile(
          name = "Diamond",
          vertices = 6..8,
          extentRange = 0.55..0.75,
          circularityRange = 0.68..0.85,
          aspectRange = 0.85..1.10,
        ),
        BundledShapeProfile(
          name = "Circle",
          vertices = 7..9,
          extentRange = 0.72..0.85,
          circularityRange = 0.60..0.80,
          aspectRange = 0.92..1.08,
        ),
        BundledShapeProfile(
          name = "Cross",
          vertices = 8..12,
          extentRange = 0.58..0.78,
          circularityRange = 0.48..0.65,
          aspectRange = 0.90..1.10,
        ),
      )
      private val ARROW_BURST_SET_NAMES = listOf("Crit Chance", "Crit Dmg", "Offense")
    private val SHAPE_ASSET_NAMES = linkedMapOf(
      "Square" to "mod-templates/shapes/square.png",
      "Arrow" to "mod-templates/shapes/arrow.png",
      "Diamond" to "mod-templates/shapes/diamond.png",
      "Triangle" to "mod-templates/shapes/triangle.png",
      "Circle" to "mod-templates/shapes/circle.png",
      "Cross" to "mod-templates/shapes/cross.png",
    )

    private const val SET_ATLAS_ASSET_PATH = "mod-templates/atlases/mod-icon-atlas.png"
    private const val SET_ATLAS_FADED_ASSET_PATH = "mod-templates/atlases/mod-icon-atlas-faded.png"
    private const val SET_ATLAS_COLUMNS = 8
    private const val SET_ATLAS_ROWS = 5
    private val REAL_SET_TEMPLATE_ASSETS = linkedMapOf(
      "Crit Chance" to "mod-templates/real-sets/critchance.png",
      "Crit Dmg" to "mod-templates/real-sets/critdmg.png",
      "Defense" to "mod-templates/real-sets/defense.png",
      "Health" to "mod-templates/real-sets/health.png",
      "Offense" to "mod-templates/real-sets/offense.png",
      "Potency" to "mod-templates/real-sets/potency.png",
      "Speed" to "mod-templates/real-sets/speed.png",
      "Tenacity" to "mod-templates/real-sets/tenacity.png",
    )
    private val PROFILE_REAL_SET_TEMPLATE_ASSETS = linkedMapOf(
      "arrow" to linkedMapOf(
        "Crit Chance" to "mod-templates/real-sets-arrow/critchance.png",
        "Crit Dmg" to "mod-templates/real-sets-arrow/critdmg.png",
        "Defense" to "mod-templates/real-sets-arrow/defense.png",
        "Health" to "mod-templates/real-sets-arrow/health.png",
        "Offense" to "mod-templates/real-sets-arrow/offense.png",
        "Potency" to "mod-templates/real-sets-arrow/potency.png",
        "Speed" to "mod-templates/real-sets-arrow/speed.png",
        "Tenacity" to "mod-templates/real-sets-arrow/tenacity.png",
      ),
      "triangle" to linkedMapOf<String, String>(),
    )
    private val SET_CROP_PROFILES = listOf("generic", "arrow", "triangle")
    private val SET_ATLAS_COLUMN_NAMES = listOf(
      "Offense",
      "Defense",
      "Speed",
      "Crit Dmg",
      "Potency",
      "Crit Chance",
      "Tenacity",
      "Health",
    )
    private val ARROW_BURST_PATCH_TEMPLATES = mapOf(
      "Crit Chance" to doubleArrayOf(
        0.0000, 0.0000, 0.0000, 0.0000,
        0.1357, 0.1346, 0.1918, 0.1394,
        0.2704, 0.5285, 0.1722, 0.1596,
        0.3092, 0.4478, 0.1614, 0.1618,
      ),
      "Crit Dmg" to doubleArrayOf(
        0.0000, 0.0000, 0.0000, 0.0000,
        0.1577, 0.1564, 0.2144, 0.1715,
        0.3325, 0.4709, 0.1996, 0.1962,
        0.3840, 0.4436, 0.1891, 0.1988,
      ),
      "Offense" to doubleArrayOf(
        0.0000, 0.0000, 0.0000, 0.0000,
        0.1352, 0.1340, 0.1964, 0.1573,
        0.3206, 0.5506, 0.1794, 0.1816,
        0.3724, 0.5509, 0.1678, 0.1842,
      ),
    )
    private val ARROW_BURST_METRIC_TEMPLATES = mapOf(
      "Crit Chance" to doubleArrayOf(-0.02536134453781512, 0.5633165266106442, 0.6238610644257702, 0.8447058823529412),
      "Crit Dmg" to doubleArrayOf(-0.015501400560224032, 0.6985994397759101, 0.6908168067226886, 0.7741176470588236),
      "Offense" to doubleArrayOf(-0.01270588235294115, 0.5954173669467785, 0.654355182072829, 0.8305882352941176),
    )

    @Volatile
    private var openCvReady = false

    @Volatile
    private var openCvLoadAttempted = false

    private fun ensureOpenCvReady(): Boolean {
      if (openCvReady) return true
      if (openCvLoadAttempted) return false
      return synchronized(this) {
        if (openCvReady) return@synchronized true
        if (openCvLoadAttempted) return@synchronized false
        openCvLoadAttempted = true
        try {
          openCvReady = OpenCVLoader.initLocal()
          if (!openCvReady) {
            Log.e(TAG, "OpenCVLoader.initLocal() returned false")
          }
          openCvReady
        } catch (primary: Throwable) {
          Log.w(TAG, "OpenCVLoader.initLocal() failed, trying direct library load", primary)
          try {
            System.loadLibrary("opencv_java4")
            openCvReady = true
            true
          } catch (fallback: Throwable) {
            Log.e(TAG, "Failed to load OpenCV native library", fallback)
            false
          }
        }
      }
    }
  }
}
