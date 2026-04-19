// ── Primary stat abbreviation → display name ────────────────────────────────
export const PRIMARY_MAP = {
  Sp: 'Speed',
  O: 'Offense%',
  H: 'Health%',
  P: 'Protection%',
  Ac: 'Accuracy%',
  CA: 'Crit Avoidance%',
  T: 'Tenacity%',
  CC: 'Crit Chance%',
  CD: 'Crit Dmg%',
  D: 'Defense%',
  Po: 'Potency%',
  '-': 'Any',
};

export function decodePrimary(abbr) {
  return PRIMARY_MAP[abbr] ?? abbr;
}

// ── Mod-set abbreviation → display name ─────────────────────────────────────
const SET_ABBR_MAP = {
  's4cc2': 'Speed(x4)+Crit Chance(x2)',
  's4h2':  'Speed(x4)+Health(x2)',
  's4p2':  'Speed(x4)+Potency(x2)',
  's4t2':  'Speed(x4)+Tenacity(x2)',
  's4d2':  'Speed(x4)+Defense(x2)',
  'o4cc2': 'Offense(x4)+Crit Chance(x2)',
  'o4h2':  'Offense(x4)+Health(x2)',
  'o4p2':  'Offense(x4)+Potency(x2)',
  'o4t2':  'Offense(x4)+Tenacity(x2)',
  'cd4cc2':'Crit Dmg(x4)+Crit Chance(x2)',
  'cd4h2': 'Crit Dmg(x4)+Health(x2)',
  'cd3cc3':'Crit Dmg(x3)+Crit Chance(x3)',
  'cd3h3': 'Crit Dmg(x3)+Health(x3)',
  'cc2o4': 'Crit Chance(x2)+Offense(x4)',
  'cc2s4': 'Crit Chance(x2)+Speed(x4)',
  'cc4o2': 'Crit Chance(x4)+Offense(x2)',
  'cc4p2': 'Crit Chance(x4)+Potency(x2)',
  'cc4s2': 'Crit Chance(x4)+Speed(x2)',
  'h4d2':  'Health(x4)+Defense(x2)',
  'h4p2':  'Health(x4)+Potency(x2)',
  'h4s2':  'Health(x4)+Speed(x2)',
  'h4t2':  'Health(x4)+Tenacity(x2)',
  'h6':    'Health(x6)',
  'd4h2':  'Defense(x4)+Health(x2)',
  'p4h2':  'Potency(x4)+Health(x2)',
  'p4s2':  'Potency(x4)+Speed(x2)',
  't4h2':  'Tenacity(x4)+Health(x2)',
  't4s2':  'Tenacity(x4)+Speed(x2)',
  '-':     'Any',
};

export function decodeModSet(val) {
  if (!val) return 'Any';
  return SET_ABBR_MAP[val] ?? val;
}

// ── Role abbreviation → display name ────────────────────────────────────────
export function decodeRole(abbr) {
  const map = {
    A: 'Attacker',
    S: 'Support',
    K: 'Tank',
    He: 'Healer',
    Leader: 'Leader',
    'Support/Attacker': 'Support/Attacker',
    'Tank/Leader': 'Tank/Leader',
  };
  return map[abbr] ?? abbr;
}

// ── Mod-set → accent colour ──────────────────────────────────────────────────
export function setColor(setStr) {
  const s = setStr ?? '';
  if (s.includes('Speed'))       return '#38bdf8';
  if (s.includes('Offense'))     return '#fb923c';
  if (s.includes('Crit Dmg'))    return '#f87171';
  if (s.includes('Crit Chance')) return '#facc15';
  if (s.includes('Health'))      return '#4ade80';
  if (s.includes('Defense'))     return '#94a3b8';
  if (s.includes('Potency'))     return '#c084fc';
  if (s.includes('Tenacity'))    return '#2dd4bf';
  return '#e2e8f0';
}

// ── Slice reference thresholds ───────────────────────────────────────────────
export const SLICE_REF = [
  { s: 'Speed',        m5: 30,    m6: 31,    g: 15,   gr: 22  },
  { s: 'Offense',      m5: 228,   m6: 251,   g: 90,   gr: 140 },
  { s: 'Offense%',     m5: 2.815, m6: 8.5,   g: 1.5,  gr: 2.1 },
  { s: 'Health',       m5: 2143,  m6: 2700,  g: 1700, gr: 2000},
  { s: 'Health%',      m5: 5.625, m6: 10,    g: 3,    gr: 4.5 },
  { s: 'Protection',   m5: 4153,  m6: 4600,  g: 1200, gr: 1800},
  { s: 'Protection%',  m5: 11.25, m6: 15,    g: 5.8,  gr: 8.5 },
  { s: 'Defense',      m5: 49,    m6: 80,    g: 26,   gr: 40  },
  { s: 'Defense%',     m5: 8.5,   m6: 20,    g: 5.9,  gr: 8.5 },
  { s: 'Crit Chance%', m5: 11.25, m6: 11.75, g: 5.9,  gr: 8.5 },
  { s: 'Potency%',     m5: 11.25, m6: 15,    g: 5.9,  gr: 8.5 },
  { s: 'Tenacity%',    m5: 11.25, m6: 15,    g: 5.9,  gr: 8.5 },
];

// ── Secondary stat quality colour ───────────────────────────────────────────
// Returns colour based on value vs good/great thresholds
export function secQualityColor(statName, value) {
  const ref = SLICE_REF.find(r => r.s === statName);
  if (!ref || value === null || value === undefined) return '#e2e8f0';
  const v = parseFloat(value);
  if (isNaN(v) || v <= 0) return '#e2e8f0';
  if (v >= ref.gr) return '#c084fc'; // purple – Strong
  if (v >= ref.g)  return '#60a5fa'; // blue   – Good
  return '#4ade80';                  // green  – Partial
}

// Flat stats — valuable as secondaries but much weaker than their % counterparts.
// Speed is excluded: flat Speed is the most valuable secondary in the game.
export const FLAT_STATS = new Set(['Offense', 'Health', 'Protection', 'Defense']);

// Priority-position colour (for Lookup/Finder where we don't have values)
// Flat stats get a muted color regardless of priority position.
export function secPriorityColor(position, stat = '') {
  if (FLAT_STATS.has(stat)) return '#475569'; // gray – flat stat, low value
  if (position <= 1) return '#c084fc'; // purple – top priority
  if (position === 2) return '#60a5fa'; // blue
  return '#4ade80';                    // green
}

// ── Available secondary stats ────────────────────────────────────────────────
export const SEC_STATS = [
  'Speed',
  'Offense%',
  'Offense',
  'Health%',
  'Health',
  'Protection%',
  'Protection',
  'Defense%',
  'Defense',
  'Crit Chance%',
  'Potency%',
  'Tenacity%',
];

// ── Arrow primaries ──────────────────────────────────────────────────────────
export const ARROW_PRIMARIES    = ['Speed','Accuracy%','Crit Avoidance%','Health%','Protection%','Offense%','Defense%'];
export const TRIANGLE_PRIMARIES = ['Crit Chance%','Crit Dmg%','Health%','Protection%','Offense%','Defense%'];
export const CIRCLE_PRIMARIES   = ['Health%','Protection%'];
export const CROSS_PRIMARIES    = ['Tenacity%','Potency%','Health%','Protection%','Offense%','Defense%'];
export const SQUARE_PRIMARIES  = ['Offense%'];
export const DIAMOND_PRIMARIES = ['Defense%'];

export const SHAPE_PRIMARIES = {
  Arrow:    ARROW_PRIMARIES,
  Triangle: TRIANGLE_PRIMARIES,
  Circle:   CIRCLE_PRIMARIES,
  Cross:    CROSS_PRIMARIES,
  Square:   SQUARE_PRIMARIES,
  Diamond:  DIAMOND_PRIMARIES,
};

export const SHAPES = ['Arrow','Triangle','Circle','Cross','Square','Diamond'];

// Mod sets available in finder
export const MOD_SETS = [
  'Speed','Offense','Crit Dmg','Crit Chance','Health','Defense','Potency','Tenacity',
];

// ── Per-roll min/max and stat caps (5-dot + 6-dot) ──────────────────────────
export const ROLL_DATA = {
  'Speed':        { min5: 3,     max5: 6,     cap5: 30,    min6: 3,     max6: 6,    cap6: 31    },
  'Offense':      { min5: 22.8,  max5: 45.6,  cap5: 228,   min6: 25,    max6: 50,   cap6: 251   },
  'Offense%':     { min5: 0.281, max5: 0.563, cap5: 2.815, min6: 0.85,  max6: 1.7,  cap6: 8.5   },
  'Health':       { min5: 214.3, max5: 428.6, cap5: 2143,  min6: 270,   max6: 540,  cap6: 2700  },
  'Health%':      { min5: 0.563, max5: 1.125, cap5: 5.625, min6: 1,     max6: 2,    cap6: 10    },
  'Protection':   { min5: 415.3, max5: 830.6, cap5: 4153,  min6: 460,   max6: 920,  cap6: 4600  },
  'Protection%':  { min5: 1.125, max5: 2.25,  cap5: 11.25, min6: 1.5,   max6: 3,    cap6: 15    },
  'Defense':      { min5: 4.9,   max5: 9.8,   cap5: 49,    min6: 8,     max6: 16,   cap6: 80    },
  'Defense%':     { min5: 0.85,  max5: 1.70,  cap5: 8.5,   min6: 2,     max6: 4,    cap6: 20    },
  'Crit Chance%': { min5: 1.125, max5: 2.25,  cap5: 11.25, min6: 1.175, max6: 2.35, cap6: 11.75 },
  'Potency%':     { min5: 1.125, max5: 2.25,  cap5: 11.25, min6: 1.5,   max6: 3,    cap6: 15    },
  'Tenacity%':    { min5: 1.125, max5: 2.25,  cap5: 11.25, min6: 1.5,   max6: 3,    cap6: 15    },
};

// 5A → 6E percent boost — how much slicing to 6-dot multiplies the stat cap.
// Drives whether a mod is worth the 6-dot material cost.
export const SLICE_GAIN = {
  'Offense%':     2.02,
  'Defense%':     1.34,
  'Health%':      0.78,
  'Defense':      0.63,
  'Potency%':     0.33,
  'Tenacity%':    0.33,
  'Protection%':  0.33,
  'Health':       0.26,
  'Protection':   0.11,
  'Offense':      0.10,
  'Crit Chance%': 0.04,
  'Speed':        0.03,
};

// Roll efficiency 0..1 — Crouching-Rancor style.
// Tells how well the N rolls behind a secondary performed relative to possible range.
export function rollEfficiency(stat, value, rolls, dotLevel = 5) {
  const data = ROLL_DATA[stat];
  if (!data) return null;
  const r = parseInt(rolls, 10);
  const v = parseFloat(value);
  if (!r || r <= 0 || isNaN(v)) return null;
  const min = dotLevel === 6 ? data.min6 : data.min5;
  const max = dotLevel === 6 ? data.max6 : data.max5;
  const lo = r * min;
  const hi = r * max;
  if (hi === lo) return 1;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

export function efficiencyColor(eff) {
  if (eff === null || eff === undefined) return '#e2e8f0';
  if (eff >= 0.8) return '#c084fc';
  if (eff >= 0.5) return '#60a5fa';
  if (eff >= 0.2) return '#4ade80';
  return '#f87171';
}

export function efficiencyLabel(eff) {
  if (eff === null || eff === undefined) return '—';
  if (eff >= 0.8) return 'Elite';
  if (eff >= 0.5) return 'Good';
  if (eff >= 0.2) return 'Weak';
  return 'Min';
}

export const MOD_TIERS = ['5E', '5D', '5C', '5B', '5A', '6E'];
