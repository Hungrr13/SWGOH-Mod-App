import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Image, Dimensions } from "react-native";

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

const STAR_COUNT = 70;
const STAR_COLORS = ["#d7e7ff", "#c1dcff", "#fef3c7", "#a5f3fc", "#ffffff"];

function generateStars(width, height) {
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      id: i,
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1 + Math.random() * 2.6,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      baseOpacity: 0.25 + Math.random() * 0.55,
      twinkleDuration: 800 + Math.random() * 2200,
      delay: Math.random() * 2000,
    });
  }
  return stars;
}

function TwinkleStar({ star }) {
  const opacity = useRef(new Animated.Value(star.baseOpacity)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: Math.min(1, star.baseOpacity + 0.55),
          duration: star.twinkleDuration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: Math.max(0.1, star.baseOpacity - 0.25),
          duration: star.twinkleDuration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    const timeout = setTimeout(() => loop.start(), star.delay);
    return () => {
      clearTimeout(timeout);
      loop.stop();
    };
  }, [opacity, star]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: star.x,
        top: star.y,
        width: star.size,
        height: star.size,
        borderRadius: star.size,
        backgroundColor: star.color,
        opacity,
      }}
    />
  );
}

export default function LoadingScreen() {
  const pulse = useRef(new Animated.Value(0.95)).current;
  const fade = useRef(new Animated.Value(0.45)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const phraseOpacity = useRef(new Animated.Value(1)).current;
  const [phraseIndex, setPhraseIndex] = useState(
    () => Math.floor(Math.random() * STATUS_PHRASES.length),
  );
  const [rosterStage, setRosterStage] = useState(0);
  const [buildStage, setBuildStage] = useState(0);
  const [sliceStage, setSliceStage] = useState(0);

  const stars = useMemo(() => {
    const { width, height } = Dimensions.get("window");
    return generateStars(width, height);
  }, []);

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
  }, [pulse, fade, drift]);

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

  const driftInterpolate = drift.interpolate({
    inputRange: [0, 1],
    outputRange: ["-3deg", "3deg"],
  });

  return (
    <View style={styles.container}>
      {stars.map(star => (
        <TwinkleStar key={star.id} star={star} />
      ))}
      <View style={styles.glowOrb} />

      <Animated.View
        style={[
          styles.markWrap,
          {
            transform: [{ scale: pulse }, { rotate: driftInterpolate }],
          },
        ]}
      >
        <Image
          source={require("../../assets/adaptive-icon.png")}
          style={styles.markImage}
          resizeMode="contain"
        />
      </Animated.View>

      <Text style={styles.title}>ModForge</Text>
      <Text style={styles.tagline}>Mod Optimizer for SWGOH</Text>

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
    backgroundColor: "#070b18",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    overflow: "hidden",
  },
  glowOrb: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(99, 102, 241, 0.10)",
  },
  markWrap: {
    marginBottom: 18,
    shadowColor: "#22d3ee",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  markImage: {
    width: 168,
    height: 168,
  },
  title: {
    color: "#f8fafc",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 4,
  },
  tagline: {
    color: "#94a3b8",
    fontSize: 12,
    letterSpacing: 6,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 22,
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
