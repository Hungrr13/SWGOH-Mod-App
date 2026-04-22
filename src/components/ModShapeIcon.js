import React from 'react';
import { Image, View } from 'react-native';

// Accent color per shape — kept exported so other UI can tint borders/text
// to match the icon palette.
export const SHAPE_COLORS = {
  Square:   '#38bdf8', // sky blue   – Transmitter
  Arrow:    '#4ade80', // green      – Receiver
  Diamond:  '#c084fc', // purple     – Processor
  Triangle: '#fb923c', // orange     – Holo-Array
  Circle:   '#facc15', // gold       – Data-Bus
  Cross:    '#fb923c', // orange     – Multiplexer
};

const SHAPE_SOURCES = {
  Square:   require('../../assets/shapes/square.png'),
  Arrow:    require('../../assets/shapes/arrow.png'),
  Diamond:  require('../../assets/shapes/diamond.png'),
  Triangle: require('../../assets/shapes/triangle.png'),
  Circle:   require('../../assets/shapes/circle.png'),
  Cross:    require('../../assets/shapes/cross.png'),
};

// Arrow + Cross PNGs have thin, sparse silhouettes and read smaller than
// the filled shapes at the same bounding-box size. Scale them up a touch
// so the row of icons looks visually balanced.
const SHAPE_SCALE = {
  Arrow: 1.18,
  Cross: 1.18,
};

export default function ModShapeIcon({ shape, size = 22 }) {
  const source = SHAPE_SOURCES[shape];
  if (!source) return <View style={{ width: size, height: size }} />;
  const scaled = Math.round(size * (SHAPE_SCALE[shape] || 1));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={source}
        style={{ width: scaled, height: scaled }}
        resizeMode="contain"
      />
    </View>
  );
}
