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

// Priority-position colour (for Lookup/Finder where we don't have values)
export function secPriorityColor(position) {
  if (position <= 1) return '#c084fc'; // purple – top priority
  if (position === 2) return '#60a5fa'; // blue
  return '#4ade80';                    // green
}

// ── Available secondary stats ────────────────────────────────────────────────
export const SEC_STATS = [
  'Speed',
  'Offense',
  'Offense%',
  'Health',
  'Health%',
  'Protection',
  'Protection%',
  'Defense',
  'Defense%',
  'Crit Chance%',
  'Potency%',
  'Tenacity%',
];

// ── Arrow primaries ──────────────────────────────────────────────────────────
export const ARROW_PRIMARIES = ['Speed','Offense%','Health%','Protection%','Accuracy%','Crit Avoidance%','Tenacity%'];
export const TRIANGLE_PRIMARIES = ['Crit Dmg%','Crit Chance%','Offense%','Health%','Protection%','Defense%'];
export const CIRCLE_PRIMARIES  = ['Health%','Protection%'];
export const CROSS_PRIMARIES   = ['Offense%','Health%','Protection%','Potency%','Tenacity%'];
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

// ── Slice verdict logic ──────────────────────────────────────────────────────
export function calcSliceVerdict(shape, secs) {
  // secs = [{stat, value}] up to 4 entries
  const filled = secs.filter(s => s.stat && s.value !== '');

  let goodCount = 0;
  let greatCount = 0;
  let hasSpeed = false;
  let speedVal = 0;

  for (const { stat, value } of filled) {
    const ref = SLICE_REF.find(r => r.s === stat);
    if (!ref) continue;
    const v = parseFloat(value);
    if (isNaN(v)) continue;
    if (v >= ref.gr) greatCount++;
    else if (v >= ref.g) goodCount++;
    if (stat === 'Speed') { hasSpeed = true; speedVal = v; }
  }

  const isFixed = shape === 'Square' || shape === 'Diamond';
  const isArrow = shape === 'Arrow';

  // Speed arrow rules
  if (isArrow && hasSpeed) {
    if (greatCount >= 3) return { label: 'SLICE HIGH', color: '#4ade80', desc: 'Speed arrow with 3+ great stats – top priority to slice!' };
    if (greatCount >= 2) return { label: 'SLICE', color: '#86efac', desc: 'Speed arrow with 2 great stats – good slice candidate.' };
  }

  // Non-arrow high-speed
  if (!isFixed && hasSpeed && speedVal >= 20) {
    return { label: 'SLICE TOP', color: '#4ade80', desc: 'High speed secondary – slice for maximum gain.' };
  }
  if (!isFixed && hasSpeed && speedVal >= 15) {
    return { label: 'SLICE', color: '#86efac', desc: 'Decent speed – slice candidate.' };
  }

  // Great stats
  if (greatCount >= 3) return { label: 'SLICE', color: '#86efac', desc: '3+ great stats – strong mod worth slicing.' };
  if (greatCount >= 2 && goodCount >= 1) return { label: 'SLICE', color: '#86efac', desc: '2 great + 1 good – slice candidate.' };

  // Fixed slots (Square/Diamond) – always useful
  if (isFixed && filled.length > 0) return { label: 'KEEP', color: '#facc15', desc: 'Fixed primary slot – keep for set completion.' };

  // Good but not great
  if (goodCount >= 3 || greatCount >= 1) return { label: 'KEEP', color: '#facc15', desc: 'Solid stats – keep but lower slice priority.' };

  if (filled.length === 0) return { label: '—', color: '#94a3b8', desc: 'Enter secondary stats to see the verdict.' };

  return { label: 'SELL', color: '#f87171', desc: 'Weak stats – likely not worth keeping.' };
}
