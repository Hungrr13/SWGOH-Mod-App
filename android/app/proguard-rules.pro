# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Our native modules — must keep class names + @ReactMethod method names
# so the JS bridge can find them by string lookup at runtime. R8 would
# otherwise rename them and the require() side becomes unreachable.
-keep class com.hungrr13.modhelper.overlay.** { *; }
-keep class com.hungrr13.modhelper.iap.** { *; }

# React Native bridge surface that other native modules rely on by name.
# The default RN proguard rules cover most of this, but be defensive.
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
    @com.facebook.react.bridge.ReactMethod <methods>;
}

# RSA / Signature classes used for IAP receipt verification — keep so
# R8 doesn't strip them on the assumption that nothing reflects into
# the security provider.
-keep class java.security.** { *; }
-keep class javax.crypto.** { *; }

# R8 missing-class warnings from the Google Mobile Ads SDK / Play Services.
# These reference Android API 35+ classes (we compile against API 34) and
# are guarded at runtime by SDK_INT checks inside the AdMob library, so
# silencing them is safe. Add new entries here as R8 reports more.
-dontwarn android.media.LoudnessCodecController
-dontwarn android.media.LoudnessCodecController$OnLoudnessCodecUpdateListener

# Add any project specific keep options here:
