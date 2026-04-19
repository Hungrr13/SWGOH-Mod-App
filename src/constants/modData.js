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

// Quality color driven by efficiency (preferred when rolls known)
export function efficiencyColor(eff) {
  if (eff === null || eff === undefined) return '#e2e8f0';
  if (eff >= 0.8) return '#c084fc'; // purple  – Elite roll
  if (eff >= 0.5) return '#60a5fa'; // blue    – Good
  if (eff >= 0.2) return '#4ade80'; // green   – Weak
  return '#f87171';                 // red     – Bottom tier
}

export function efficiencyLabel(eff) {
  if (eff === null || eff === undefined) return '—';
  if (eff >= 0.8) return 'Elite';
  if (eff >= 0.5) return 'Good';
  if (eff >= 0.2) return 'Weak';
  return 'Min';
}

export const MOD_TIERS = ['5C', '5B', '5A', '6E'];

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
// Tier-gated progressive slicing: at each 5-dot tier (5C→5B→5A) we decide
// whether rolls are promising enough to keep investing. At 5A we decide on
// the 6-dot commitment. Each secondary is judged by roll efficiency, and
// %-stats with big 5A→6E gains are weighted more heavily.
//
// Speed rules (community wisdom — Crouching Rancor / SWGOH subreddit):
//   - Speed with ≥3 rolls → slice aggressively (speed has been hitting)
//   - Speed arrow + any speed secondary → slice regardless
//   - Speed with 1 roll at 5A → KEEP, don't 6-dot (fluke risk, +3% max gain)
//
// secs: [{stat, value, rolls, hidden}] — rolls is the scan's "#" count (1..5),
// hidden=true means the scan showed "Reveals at level 3/6/9/12".
// tier: one of MOD_TIERS
export function calcSliceVerdict(shape, secs, tier = '5A') {
  // Hidden secondaries first — can't judge without seeing all stats.
  const hiddenCount = (secs || []).filter(s => s && s.hidden).length;
  if (hiddenCount > 0) {
    return {
      label: 'LEVEL TO 12',
      color: '#f5a623',
      desc: `${hiddenCount} secondary${hiddenCount > 1 ? ' stats reveal' : ' stat reveals'} at levels 3/6/9/12. Level the mod to 12 and rescan for an accurate slice recommendation.`,
    };
  }

  const dotLevel = tier.startsWith('6') ? 6 : 5;
  const filled = secs.filter(s => s.stat && s.value !== '' && parseInt(s.rolls, 10) > 0);

  if (filled.length === 0) {
    return { label: '—', color: '#94a3b8', desc: 'Enter stats, values, and roll counts to see the verdict.' };
  }

  const analyzed = filled.map(s => {
    const eff = rollEfficiency(s.stat, s.value, s.rolls, dotLevel);
    const gain = SLICE_GAIN[s.stat] ?? 0;
    return { ...s, rolls: parseInt(s.rolls, 10), eff: eff ?? 0, gain };
  });

  const avgEff = analyzed.reduce((a, s) => a + s.eff, 0) / analyzed.length;
  const speed = analyzed.find(s => s.stat === 'Speed');
  const highGain = analyzed.filter(s => s.gain >= 0.5); // Offense%, Defense%, Health%
  const strongHighGain = highGain.filter(s => s.eff >= 0.7);
  const isFixed = shape === 'Square' || shape === 'Diamond';
  const isSpeedArrow = shape === 'Arrow'; // arrow shape tends to carry speed primary

  // 5C → slice to 5B? (cheap tier, forgiving)
  if (tier === '5C') {
    if (speed || highGain.length >= 1 || avgEff >= 0.4) {
      return {
        label: 'SLICE → 5B', color: '#86efac',
        desc: speed
          ? 'Speed secondary present — always worth climbing. Slice to 5B and rescan.'
          : 'Early rolls promising — continue to 5B and rescan.',
      };
    }
    if (isFixed) return { label: 'KEEP', color: '#facc15', desc: 'Fixed slot — keep for set completion.' };
    return { label: 'SELL', color: '#f87171', desc: 'Weak early rolls — cut losses before 5B.' };
  }

  // 5B → slice to 5A? (last 5-dot commitment)
  if (tier === '5B') {
    const speedWorthy = speed && speed.eff >= 0.5 && speed.rolls >= 2;
    if (avgEff >= 0.55 || speedWorthy || strongHighGain.length >= 1) {
      return {
        label: 'SLICE → 5A', color: '#86efac',
        desc: speedWorthy
          ? `Speed at ${speed.value} across ${speed.rolls} rolls — finish the 5-dot climb.`
          : 'Rolls trending well — finish the 5-dot climb.',
      };
    }
    // Single-roll speed is tempting but risky — community advice: keep, don't push
    if (speed && speed.rolls === 1) {
      return {
        label: 'KEEP', color: '#facc15',
        desc: 'Speed with only 1 roll — keep but don\'t commit to 5A yet. Finish remaining upgrades on cheaper mods first.',
      };
    }
    if (isFixed) return { label: 'KEEP', color: '#facc15', desc: 'Fixed slot — keep for set completion.' };
    return { label: 'SELL', color: '#f87171', desc: 'Rolls too weak to justify 5A materials.' };
  }

  // 5A → commit to 6-dot? (big material cost, big payoff on %-stats)
  if (tier === '5A') {
    // Speed arrow + any speed secondary → always slice (rare, valuable)
    if (isSpeedArrow && speed) {
      return {
        label: 'SLICE → 6E', color: '#4ade80',
        desc: 'Speed arrow with speed secondary — always worth 6-dot regardless of efficiency.',
      };
    }
    // Multi-rolled speed → slice aggressively
    if (speed && speed.rolls >= 3) {
      return {
        label: 'SLICE → 6E', color: '#4ade80',
        desc: `Speed hit ${speed.rolls} times already (value ${speed.value}) — high probability of further speed on 6-dot slice.`,
      };
    }
    // Strong high-gain %-stat mod (Offense%/Defense%/Health%) — biggest payoff
    if (strongHighGain.length >= 1 && avgEff >= 0.55) {
      const top = strongHighGain[0];
      return {
        label: 'SLICE → 6E', color: '#4ade80',
        desc: `${top.stat} rolled at ${Math.round(top.eff * 100)}% efficiency — 6-dot slice multiplies cap by ${Math.round((1 + top.gain) * 100) / 100}×.`,
      };
    }
    // Well-rolled speed (2 rolls, strong eff) plus a decent mod overall
    if (speed && speed.rolls >= 2 && speed.eff >= 0.5 && avgEff >= 0.55) {
      return {
        label: 'SLICE → 6E', color: '#4ade80',
        desc: `Speed at ${speed.value} (${speed.rolls} rolls) with solid overall efficiency — worth 6-dot.`,
      };
    }
    // Single-roll speed at 5A — community advice: KEEP, don't 6-dot
    if (speed && speed.rolls === 1) {
      return {
        label: 'KEEP', color: '#facc15',
        desc: 'Speed only hit once — 6-dot gain is just +1 speed max (+3%). Use on a B-tier toon; don\'t burn 6-dot materials.',
      };
    }
    if (avgEff >= 0.5 || isFixed) {
      return {
        label: 'KEEP', color: '#facc15',
        desc: 'Solid 5A — usable, but efficiency doesn\'t justify 6-dot investment.',
      };
    }
    return { label: 'SELL', color: '#f87171', desc: 'Rolled poorly — not worth 6-dot cost.' };
  }

  // 6E → already sliced; just rate the finished mod
  if (avgEff >= 0.75) return { label: 'TOP TIER', color: '#c084fc', desc: 'Elite 6-dot mod — lock it on your best toon.' };
  if (avgEff >= 0.5)  return { label: 'KEEP',     color: '#facc15', desc: 'Good 6-dot mod.' };
  return { label: 'USABLE', color: '#60a5fa', desc: 'Average 6-dot — niche use only.' };
}

// ── Character matching ──────────────────────────────────────────────────────
// Rank characters by how well a mod's shape/primary/secondaries align with
// their recommended build (primary + priority-ordered secondaries + mod set).
export function matchCharactersForMod(chars, { shape, primary, secs, modSet }) {
  const shapeKey = {
    Arrow: 'arrow', Triangle: 'triangle', Circle: 'circle', Cross: 'cross',
  }[shape];
  // Reverse PRIMARY_MAP: display name → abbr
  const primaryAbbr = primary
    ? Object.keys(PRIMARY_MAP).find(k => PRIMARY_MAP[k] === primary)
    : null;
  const filledStats = (secs || [])
    .filter(s => s && s.stat)
    .map(s => s.stat);

  const results = chars.map(c => {
    let score = 0;
    const reasons = [];

    // Primary match on the correct shape (main build)
    if (shapeKey && primaryAbbr && c[shapeKey] === primaryAbbr) {
      score += 5;
      reasons.push('primary');
    }
    // Backup build primary match (Triangle/Circle/Cross only)
    const buKey = { Triangle: 'buTri', Circle: 'buCir', Cross: 'buCro' }[shape];
    if (buKey && primaryAbbr && c[buKey] === primaryAbbr && score === 0) {
      score += 3;
      reasons.push('backup primary');
    }
    // Mod-set match
    if (modSet) {
      const full = decodeModSet(c.modSet).toLowerCase();
      const buFull = decodeModSet(c.buSet).toLowerCase();
      const needle = modSet.toLowerCase();
      if (full.includes(needle)) { score += 3; reasons.push('set'); }
      else if (buFull.includes(needle)) { score += 1; reasons.push('backup set'); }
    }
    // Secondary priority match (higher priority = more points)
    const charSecs = (c.secs || '').split('>').map(s => s.trim()).filter(Boolean);
    let secMatches = 0;
    filledStats.forEach(stat => {
      const idx = charSecs.indexOf(stat);
      if (idx === 0 || idx === 1) { score += 3; secMatches++; }
      else if (idx === 2)          { score += 2; secMatches++; }
      else if (idx >= 3)           { score += 1; secMatches++; }
    });
    if (secMatches > 0) reasons.push(`${secMatches} sec`);

    return { char: c, score, reasons };
  });

  return results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
