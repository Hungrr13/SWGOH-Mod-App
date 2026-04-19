// ── Slice Rules ────────────────────────────────────────────────────────────────
// Single source of truth for roll ranges, stat weights, and verdict thresholds.
// Min/max roll values derived from the official 5-dot level 12 roll table.

export const ROLL_RANGES = {
  'Speed':        { min: 3,     max: 6     },
  'Offense':      { min: 22.8,  max: 45.6  },
  'Offense%':     { min: 0.281, max: 0.563 },
  'Health':       { min: 214.3, max: 428.6 },
  'Health%':      { min: 0.563, max: 1.125 },
  'Protection':   { min: 415.3, max: 830.6 },
  'Protection%':  { min: 1.125, max: 2.25  },
  'Defense':      { min: 4.9,   max: 9.8   },
  'Defense%':     { min: 0.85,  max: 1.70  },
  'Crit Chance%': { min: 1.125, max: 2.25  },
  'Potency%':     { min: 1.125, max: 2.25  },
  'Tenacity%':    { min: 1.125, max: 2.25  },
};

// Higher weight = more valuable when scoring a mod's worth
export const STAT_WEIGHT = {
  'Speed':        3.0,
  'Offense%':     2.0,
  'Crit Chance%': 2.0,
  'Protection%':  1.5,
  'Health%':      1.5,
  'Potency%':     1.2,
  'Tenacity%':    1.2,
  'Defense%':     1.0,
  'Offense':      0.8,
  'Health':       0.6,
  'Protection':   0.6,
  'Defense':      0.5,
};

// Flat stats — valuable but much weaker than % variants (Speed is never "flat" in this sense)
export const FLAT_STATS = new Set(['Offense', 'Health', 'Protection', 'Defense']);

// finalScore thresholds for verdict
export const VERDICT_THRESHOLDS = {
  SLICE_HIGH: 75,
  SLICE:      52,
  KEEP:       32,
};

// Upgrade flat sec stat to % equivalent for character build matching
export const TO_PERCENT = {
  'Offense':    'Offense%',
  'Health':     'Health%',
  'Protection': 'Protection%',
  'Defense':    'Defense%',
};
