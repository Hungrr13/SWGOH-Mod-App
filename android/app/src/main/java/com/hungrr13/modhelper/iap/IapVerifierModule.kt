package com.hungrr13.modhelper.iap

import android.text.TextUtils
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * Verifies a Google Play in-app purchase signature using the developer's
 * public RSA key from the Play Console (Monetize → Licensing).
 *
 * receiptJson  — the raw JSON string Google sent (`purchase.dataAndroid` /
 *                `INAPP_PURCHASE_DATA`). Must be the exact bytes Google
 *                signed; do NOT re-serialize it.
 * signatureB64 — base64-encoded RSA-SHA1 signature
 *                (`purchase.signatureAndroid` / `INAPP_DATA_SIGNATURE`).
 * publicKeyB64 — base64-encoded X.509 SubjectPublicKeyInfo from the Play
 *                Console. Strip whitespace before passing.
 *
 * Resolves true if the signature is valid, false otherwise. Rejects only
 * for programmer errors (missing arg). A bad/forged signature is the
 * normal "false" path, not an error.
 */
class IapVerifierModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ModForgeIapVerifier"

  @ReactMethod
  fun verifyPurchase(
    receiptJson: String?,
    signatureB64: String?,
    publicKeyB64: String?,
    promise: Promise
  ) {
    if (TextUtils.isEmpty(receiptJson) ||
        TextUtils.isEmpty(signatureB64) ||
        TextUtils.isEmpty(publicKeyB64)) {
      promise.reject("E_BAD_ARGS", "receiptJson, signatureB64, and publicKeyB64 are required")
      return
    }
    try {
      val publicKey = decodePublicKey(publicKeyB64!!)
      val sig = Signature.getInstance("SHA1withRSA")
      sig.initVerify(publicKey)
      sig.update(receiptJson!!.toByteArray(Charsets.UTF_8))
      val sigBytes = Base64.decode(signatureB64, Base64.DEFAULT)
      val ok = sig.verify(sigBytes)
      promise.resolve(ok)
    } catch (e: IllegalArgumentException) {
      // Malformed base64 in signature or public key → treat as failed
      // verification rather than a fatal error so callers can deny the
      // purchase without crashing.
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("E_VERIFY_FAILED", e.message ?: "verification failed", e)
    }
  }

  private fun decodePublicKey(keyB64: String): PublicKey {
    val keyBytes = Base64.decode(keyB64.replace("\\s".toRegex(), ""), Base64.DEFAULT)
    val keyFactory = KeyFactory.getInstance("RSA")
    return keyFactory.generatePublic(X509EncodedKeySpec(keyBytes))
  }
}
