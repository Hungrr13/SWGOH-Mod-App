import React from 'react';
import { View, StyleSheet } from 'react-native';

// Color per shape
export const SHAPE_COLORS = {
  Square:   '#38bdf8', // sky blue   – Transmitter
  Arrow:    '#4ade80', // green      – Receiver
  Diamond:  '#c084fc', // purple     – Processor
  Triangle: '#f87171', // red        – Holo-Array
  Circle:   '#facc15', // yellow     – Data-Bus
  Cross:    '#fb923c', // orange     – Multiplexer
};

export default function ModShapeIcon({ shape, size = 22 }) {
  const color = SHAPE_COLORS[shape] ?? '#e2e8f0';
  const s = size;
  const sw = Math.max(2, Math.round(s * 0.1)); // stroke width ~10% of size

  switch (shape) {
    // ── Square (Transmitter) ─────────────────────────────────────────────────
    case 'Square':
      return (
        <View style={[{
          width: s, height: s,
          borderWidth: sw, borderColor: color,
          borderRadius: Math.round(s * 0.12),
          backgroundColor: 'transparent',
        }]} />
      );

    // ── Diamond (Processor) ─────────────────────────────────────────────────
    case 'Diamond':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{
            width: s * 0.72, height: s * 0.72,
            borderWidth: sw, borderColor: color,
            backgroundColor: 'transparent',
            transform: [{ rotate: '45deg' }],
          }} />
        </View>
      );

    // ── Circle (Data-Bus) ───────────────────────────────────────────────────
    case 'Circle':
      return (
        <View style={{
          width: s, height: s,
          borderRadius: s / 2,
          borderWidth: sw, borderColor: color,
          backgroundColor: 'transparent',
        }} />
      );

    // ── Triangle (Holo-Array) ───────────────────────────────────────────────
    case 'Triangle': {
      const triW = s;
      const triH = Math.round(s * 0.88);
      return (
        <View style={{ width: triW, height: triH, alignItems: 'center', justifyContent: 'center' }}>
          {/* Outer filled triangle minus inner — simulate stroke via two triangles */}
          <View style={{
            width: 0, height: 0,
            borderLeftWidth: triW / 2,
            borderRightWidth: triW / 2,
            borderBottomWidth: triH,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: color,
            position: 'absolute',
          }} />
          <View style={{
            width: 0, height: 0,
            borderLeftWidth: triW / 2 - sw * 1.2,
            borderRightWidth: triW / 2 - sw * 1.2,
            borderBottomWidth: triH - sw * 2,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: '#0a0e17',
            position: 'absolute',
            bottom: sw,
          }} />
        </View>
      );
    }

    // ── Arrow / Receiver ────────────────────────────────────────────────────
    case 'Arrow': {
      const headW = Math.round(s * 0.45);   // arrowhead width
      const headH = s;                       // arrowhead full height (tallest point)
      const shaftH = Math.round(s * 0.32);  // shaft thickness
      const shaftW = Math.round(s * 0.58);  // shaft length
      const mid = s / 2;
      return (
        <View style={{ width: s, height: s }}>
          {/* Shaft */}
          <View style={{
            position: 'absolute',
            left: 0,
            top: mid - shaftH / 2,
            width: shaftW,
            height: shaftH,
            backgroundColor: color,
            borderRadius: 2,
          }} />
          {/* Arrowhead triangle (border trick — right-pointing) */}
          <View style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 0,
            height: 0,
            borderTopWidth: headH / 2,
            borderBottomWidth: headH / 2,
            borderLeftWidth: headW,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
          }} />
        </View>
      );
    }

    // ── Cross / Plus (Multiplexer) ───────────────────────────────────────────
    case 'Cross': {
      const armW = Math.round(s * 0.28);
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          {/* Vertical bar */}
          <View style={{
            position: 'absolute',
            width: armW, height: s,
            backgroundColor: color,
            borderRadius: armW / 2,
          }} />
          {/* Horizontal bar */}
          <View style={{
            position: 'absolute',
            width: s, height: armW,
            backgroundColor: color,
            borderRadius: armW / 2,
          }} />
        </View>
      );
    }

    default:
      return <View style={{ width: s, height: s }} />;
  }
}
