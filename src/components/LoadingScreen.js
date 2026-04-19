import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";

const STATUS_PHRASES = [
  "Starting thrusters",
  "Entering hyperdrive",
  "Avoiding comet field",
  "Charging deflector shields",
  "Plotting jump coordinates",
  "Spooling nav computer",
  "Aligning star charts",
  "Warming reactor core",
  "Calibrating targeting computer",
  "Reticulating parsecs",
];

export default function LoadingScreen() {
  const pulse = useRef(new Animated.Value(0.95)).current;
  const fade = useRef(new Animated.Value(0.45)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const phraseOpacity = useRef(new Animated.Value(1)).current;
  const [phraseIndex, setPhraseIndex] = useState(
    () => Math.floor(Math.random() * STATUS_PHRASES.length),
  );
  const [rosterStage, setRosterStage] = useState(0);
  const [buildStage, setBuildStage] = useState(0);
  const [sliceStage, setSliceStage] = useState(0);

  useEffect(() => {
    const rand = (min, max) => min + Math.random() * (max - min);
    const timers = [];
    const schedule = (setter, stage, delay) => {
      timers.push(setTimeout(() => setter(stage), delay));
    };
    schedule(setRosterStage, 1, rand(300, 700));
    schedule(setRosterStage, 2, rand(900, 1600));
    schedule(setBuildStage, 1, rand(400, 900));
    schedule(setBuildStage, 2, rand(1800, 2800));
    schedule(setSliceStage, 1, rand(200, 600));
    schedule(setSliceStage, 2, rand(2400, 3600));
    return () => timers.forEach(clearTimeout);
  }, []);

  const stageLabel = stage => (stage === 2 ? 'Ready' : stage === 1 ? 'Syncing' : 'Loading');
  const stageColor = stage => (stage === 2 ? '#9effb9' : '#dff1ff');

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.95,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(fade, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(fade, {
          toValue: 0.45,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulse, fade, spin, drift]);

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(phraseOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setPhraseIndex(prev => {
          if (STATUS_PHRASES.length <= 1) return prev;
          let next = prev;
          while (next === prev) {
            next = Math.floor(Math.random() * STATUS_PHRASES.length);
          }
          return next;
        });
        Animated.timing(phraseOpacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    }, 3600);
    return () => clearInterval(interval);
  }, [phraseOpacity]);

  const spinInterpolate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const driftInterpolate = drift.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "8deg"],
  });

  return (
    <View style={styles.container}>
      <View style={styles.star1} />
      <View style={styles.star2} />
      <View style={styles.star3} />
      <View style={styles.star4} />
      <View style={styles.star5} />
      <View style={styles.glowOrb} />

      <Animated.View
        style={[
          styles.coreWrap,
          {
            transform: [{ scale: pulse }, { rotate: driftInterpolate }],
          },
        ]}
      >
        <View style={styles.coreOuter}>
          <Animated.View
            style={[
              styles.coreRing,
              {
                transform: [{ rotate: spinInterpolate }],
              },
            ]}
          />
          <View style={styles.coreInner}>
            <Text style={styles.coreText}>MG</Text>
          </View>
        </View>
      </Animated.View>

      <Text style={styles.title}>Mod Guide</Text>

      <View style={styles.statusPanel}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Roster Index</Text>
          <Text style={[styles.statusValue, { color: stageColor(rosterStage) }]}>
            {stageLabel(rosterStage)}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Build Profiles</Text>
          <Text style={[styles.statusValue, { color: stageColor(buildStage) }]}>
            {stageLabel(buildStage)}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Slice Engine</Text>
          <Text style={[styles.statusValue, { color: stageColor(sliceStage) }]}>
            {stageLabel(sliceStage)}
          </Text>
        </View>
      </View>

      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            {
              opacity: fade,
              transform: [{ scaleX: pulse }],
            },
          ]}
        />
      </View>

      <Animated.Text style={[styles.footer, { opacity: phraseOpacity }]}>
        {STATUS_PHRASES[phraseIndex]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#070b14",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    overflow: "hidden",
  },
  glowOrb: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(65, 145, 255, 0.08)",
  },
  star1: {
    position: "absolute",
    top: "18%",
    left: "20%",
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#d7e7ff",
    opacity: 0.8,
  },
  star2: {
    position: "absolute",
    top: "28%",
    right: "18%",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#c1dcff",
    opacity: 0.7,
  },
  star3: {
    position: "absolute",
    top: "62%",
    left: "16%",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#d7e7ff",
    opacity: 0.75,
  },
  star4: {
    position: "absolute",
    bottom: "24%",
    right: "22%",
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#cde0ff",
    opacity: 0.7,
  },
  star5: {
    position: "absolute",
    bottom: "18%",
    left: "28%",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#d7e7ff",
    opacity: 0.6,
  },
  coreWrap: {
    marginBottom: 26,
  },
  coreOuter: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    borderColor: "rgba(114, 184, 255, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 19, 34, 0.85)",
    shadowColor: "#4fa3ff",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  coreRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "rgba(98, 175, 255, 0.65)",
    borderTopColor: "#d8eeff",
    borderRightColor: "rgba(98, 175, 255, 0.2)",
    borderBottomColor: "rgba(98, 175, 255, 0.65)",
    borderLeftColor: "rgba(98, 175, 255, 0.2)",
  },
  coreInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#111a2d",
    borderWidth: 1,
    borderColor: "rgba(160, 209, 255, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  coreText: {
    color: "#e7f4ff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 2,
  },
  title: {
    color: "#eef7ff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 24,
    letterSpacing: 0.5,
  },
  subtitle: {
    color: "#8fb8e6",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
    minHeight: 20,
  },
  statusPanel: {
    width: "100%",
    maxWidth: 280,
    borderWidth: 1,
    borderColor: "rgba(114, 184, 255, 0.22)",
    backgroundColor: "rgba(14, 22, 38, 0.78)",
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  statusLabel: {
    color: "#9bb7d8",
    fontSize: 13,
  },
  statusValue: {
    color: "#dff1ff",
    fontSize: 13,
    fontWeight: "600",
  },
  barTrack: {
    width: 220,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#152238",
    overflow: "hidden",
    marginBottom: 18,
  },
  barFill: {
    width: "100%",
    height: "100%",
    backgroundColor: "#7cc3ff",
  },
  footer: {
    color: "#6783a8",
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
