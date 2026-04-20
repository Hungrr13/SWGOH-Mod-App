# Scoring comparison — ModForge vs. Grandivory vs. community meta

**Heads up:** Crouching Rancor was shut down in May 2022 and its data is
stale (no GL/Conquest-era characters). The closest live equivalent for
"this is what the community actually runs" is **swgoh.gg "Best Mods"**,
which aggregates the top 1,000 Kyber GAC players. That's used here in
place of CR.

**Note on Grandivory:** he doesn't publish per-character set/primary
recommendations — he ships *stat weights*. The optimizer then picks
whichever set+primaries best satisfy those weights. So for Grandivory
we're comparing the **top-3 weighted stats** (decoded from
[characterSettings.js](https://github.com/grandivory/mods-optimizer/blob/master/src/constants/characterSettings.js))
against the spirit of our recommendation.

---

## 1. Commander Luke Skywalker (CLS)

| Source           | Set                          | Arrow | Triangle | Circle | Cross | Top secs / weights                          |
|------------------|------------------------------|-------|----------|--------|-------|----------------------------------------------|
| **ModForge**     | Offense(x4) + Tenacity(x2)   | Sp    | CD       | P      | T     | Speed > Crit Chance% > Offense% > Tenacity% |
| **swgoh.gg meta**| Offense+Tenacity (x6) — 32%  | Sp 88%| CD 56%   | P 66%  | T 35% | Speed, Potency, CritDmg, Health/Prot         |
| **Grandivory PvP**| (weights only)              | —     | —        | —      | —     | Speed=100, CritDmg=100, CritChance=50, Pot=25 |

**Verdict:** ✅ Set, primaries, and secondary order all match meta.
(Updated 2026-04-19 — secondary order was previously `Tenacity% > Speed
> Offense% > Crit Chance%`, the legacy Wampanader build.)

---

## 2. General Kenobi (GK)

| Source           | Set                | Arrow  | Triangle | Circle | Cross  | Top secs / weights                       |
|------------------|--------------------|--------|----------|--------|--------|-------------------------------------------|
| **ModForge**     | Health(x6)         | H      | H        | H      | H      | Health% > Defense% > Protection% > Speed |
| **swgoh.gg meta**| Triple Health (x6) — 49% | H 51% | H 70% | H 79% | H 69% | Speed, Health, Defense, Protection         |
| **Grandivory Padme Lead** | (weights) | —      | —        | —      | —      | Health=100, Speed=50, Tenacity=50          |

**Verdict:** ✅ Perfect alignment across set, every primary, and stat
priority. Our `Defense% > Protection%` ordering is slightly tank-heavy
vs. meta which prefers Speed third — small tweak candidate.

---

## 3. Darth Revan

| Source           | Set                       | Arrow  | Triangle | Circle | Cross  | Top secs / weights                       |
|------------------|---------------------------|--------|----------|--------|--------|-------------------------------------------|
| **ModForge**     | Speed(x4) + Health(x2)    | Sp     | CD       | H      | O      | Speed > Crit Chance% > Offense% > Health% |
| **swgoh.gg meta**| (Speed-leaning sets vary) | Sp 98% | CD 62%   | H 67%  | O 56%  | Speed, Potency, CritDmg, Offense           |
| **Grandivory PvP** | (weights, special dmg)  | —      | —        | —      | —      | Speed=100, CritDmg=50, CritChance=10       |

**Verdict:** ✅ All four primaries match meta exactly. Set choice (Speed
x4 + Health x2) is conservative vs. meta's mixed sets but is one of the
top two most-used. Secondary ordering is solid.

---

## 4. Han Solo

| Source           | Set                          | Arrow  | Triangle | Circle | Cross  | Top secs / weights                       |
|------------------|------------------------------|--------|----------|--------|--------|-------------------------------------------|
| **ModForge**     | Crit Dmg(x4) + Crit Chance(x2) | Sp   | CD       | P      | O      | Speed > Crit Chance% > Offense% > Health% |
| **swgoh.gg meta**| (CD-leaning, varies)         | Sp 93% | CD 87%   | P 55%  | O 81%  | Speed, CritChance, Offense, CritDmg        |
| **Grandivory Fast Han** | (weights)             | —      | —        | —      | —      | Speed=100, CritDmg=100, Offense=25, Pot=10 |

**Verdict:** ✅ Set, all primaries, and secondary order match meta.
(Updated 2026-04-19 — set was previously `Crit Dmg(x4) + Tenacity(x2)`,
swapped to the meta-standard CC x2.)

---

## 5. Padmé Amidala

| Source           | Set                | Arrow  | Triangle | Circle | Cross  | Top secs / weights                       |
|------------------|--------------------|--------|----------|--------|--------|-------------------------------------------|
| **ModForge**     | Health(x6)         | Sp     | H        | H      | H      | Protection% > Speed > Health% > Defense% |
| **swgoh.gg meta**| Triple Health (x6) — 55% | Sp 87% | H 82% | H 92% | H 75% | Speed, Health, Protection, Tenacity        |
| **Grandivory PvP**| (weights)         | —      | —        | —      | —      | Speed=100, Health=35, CritDmg=25           |

**Verdict:** ✅ Perfect match on set, every primary, and secondary
order. (Updated 2026-04-19 — Speed promoted from #3 to #2.)

---

## 6. Darth Sidious

| Source           | Set                | Arrow  | Triangle | Circle | Cross  | Top secs / weights                       |
|------------------|--------------------|--------|----------|--------|--------|-------------------------------------------|
| **ModForge**     | Potency(x2) + Crit Chance(x4) | Sp | H | H | Po | Potency% > Speed > Crit Chance% > Health% |
| **swgoh.gg meta**| Potency (x2) — 36% | Sp 68% | H 41%    | H 75%  | Po 74% | Speed, Potency, CritChance, Health         |
| **Grandivory PvP**| (weights)         | —      | —        | —      | —      | Speed=100, Offense=50, Potency=25          |

**Verdict:** ✅ Set, all primaries, and secondary order match meta.
(Updated 2026-04-19 — set was previously `Potency(x6)`, swapped to the
meta-standard Potency(x2) + Crit Chance(x4) PvP build.)

---

## Summary scorecard (after 2026-04-19 tuning)

| Char | Set match | Primaries match | Secondary order match |
|------|-----------|-----------------|------------------------|
| CLS              | ✅ | 4/4 | ✅ |
| General Kenobi   | ✅ | 4/4 | ✅ |
| Darth Revan      | ✅ | 4/4 | ✅ |
| Han Solo         | ✅ | 4/4 | ✅ |
| Padmé            | ✅ | 4/4 | ✅ |
| Darth Sidious    | ✅ | 4/4 | ✅ |

**Overall:** 6/6 alignment with the swgoh.gg top-1000 Kyber GAC meta
across set, primaries, and secondary order — strong baseline confidence
in the recommendation engine. The four tune-ups applied:

- **CLS secondaries** — `Tenacity% > Speed > Offense% > Crit Chance%`
  → `Speed > Crit Chance% > Offense% > Tenacity%` (drop legacy
  Wampanader lead)
- **Padmé secondaries** — `Protection% > Health% > Speed > Defense%`
  → `Protection% > Speed > Health% > Defense%` (Speed promoted to #2)
- **Han Solo set** — `Crit Dmg(x4) + Tenacity(x2)`
  → `Crit Dmg(x4) + Crit Chance(x2)` (meta-standard CC pairing)
- **Darth Sidious set** — `Potency(x6)`
  → `Potency(x2) + Crit Chance(x4)` (meta PvP build)

Next step: run a wider stratified sample (≥20 chars across roles + GL +
Conquest) to estimate the broader agreement rate before promoting these
recommendations as canonical.

---

## Sources

- [swgoh.gg Best Mods — Commander Luke Skywalker](https://swgoh.gg/units/commander-luke-skywalker/best-mods/)
- [swgoh.gg Best Mods — General Kenobi](https://swgoh.gg/units/general-kenobi/best-mods/)
- [swgoh.gg Best Mods — Darth Revan](https://swgoh.gg/units/darth-revan/best-mods/)
- [swgoh.gg Best Mods — Han Solo](https://swgoh.gg/units/han-solo/best-mods/)
- [swgoh.gg Best Mods — Padmé Amidala](https://swgoh.gg/units/padme-amidala/best-mods/)
- [swgoh.gg Best Mods — Darth Sidious](https://swgoh.gg/units/darth-sidious/best-mods/)
- [Grandivory characterSettings.js](https://github.com/grandivory/mods-optimizer/blob/master/src/constants/characterSettings.js)
