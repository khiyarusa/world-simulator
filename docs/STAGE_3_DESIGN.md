# STAGE 3 — LIVING WORLD DESIGN CONTRACT

Authoritative design for the simulation systems added in Stage 3. Where this document and an older
document disagree, this one wins and the older one is corrected in the same commit (AGENTS.md R-41).

Status labels used throughout the project: **implemented** · **tested** · **measured** ·
**targeted (unverified)** · **pending device validation** · **deferred**.

---

## 1. Precision and units (resolves the per-mille vs 10⁶ ambiguity)

One scheme, everywhere:

| Kind | Representation | Range | Notes |
|---|---|---|---|
| Resource stock | `Int32`, **units** | 0 … 2.1e9 | 1 food unit = 1 person-day. Water/wood/stone/metal/goods share the convention: 1 unit is one consumable unit. |
| Treasury | `Int32`, **units of wealth** | 0 … 2.1e9 | derived from surplus + tariffs |
| Population | `Int32`, people | 0 … 2.1e9 | cohort sum must equal it exactly |
| Rate / modifier | **per-mille** (`1000` = 1.0) | 0 … 4000 | stored as `Uint16` |
| Derived product | `floor(base * rate / 1000)` with an explicit **carry** | | never accumulate the fraction, never round twice |

**Rule:** a stored value is a whole unit; a modifier is per-mille; a product is divided by 1000 exactly
once, and the remainder is carried in a per-settlement, per-resource `Uint16` remainder (0…999). This is
what makes daily fractional production conserve to the unit over 144,000 days instead of drifting.

There is **no 10⁶ scale in the simulation**. The `1000^3` expression in the early GDD sketch was a
three-factor multiplication example, not a storage contract. Intermediate products use
`Math.round` only through `mulDiv` (already in `core/math.ts`) and are bounded by `MAX_SAFE_INTEGER`
because both operands are ≤ 2.1e9 and the divisor is ≥ 1; the only unbounded product is guarded by
`mulDiv`'s caller contract, and every caller multiplies a per-mille value (≤ 4000) by a unit value.

## 2. The eight cohorts (resolves the incomplete taxonomy)

| # | Key | Age | Labour |
|---|---|---|---|
| 0 | `children` | 0–14 | none |
| 1 | `youth` | 15–24 | half-weight labour |
| 2 | `farmers` | 15–59 | full |
| 3 | `extractors` | 15–59 | full |
| 4 | `crafters` | 15–59 | full |
| 5 | `traders` | 15–59 | full |
| 6 | `soldiers` | 15–59 | full, fed from the military budget |
| 7 | `elders` | 60+ | none |

`population = Σ cohorts` is an invariant, not a derived convenience. Occupation shares are per-mille of
the adult pool (`2..6`), stored per settlement, and they are *moved*, never created: a cohort transfer
takes from one adult cohort and gives to another in the same tick.

Ageing is yearly and deterministic: children→youth `1/15`, youth→farmers `1/10`, farmers→elders `1/40`,
elders die at the table rate. Transfers round down and the remainder stays in the source cohort, so no
person is created by rounding.

## 3. LOD (resolves camera vs history)

**Decision (D-41):** at the Stage 3 entity caps (200 settlements) every settlement is simulated at the
same fidelity on every tick. Detail tiers exist as **derived metadata** (`focus`/`regional`/`world`) used
for render priority and future scheduling, and they are *not persisted*. The camera cannot influence
history because it never reaches a rule: the worker stores the view only for tier labelling, and no
system reads it.

Consequence: `S3-A6` is satisfied by construction (identical checksum under a fixed or moving camera).
Cadence-LOD is deferred with an explicit trigger: implement it only if the full pipeline's tick p95
exceeds 2 ms at 200 settlements on the reference device, and then with the 0.5 % / identical-events
fallback and an A/B test.

## 4. Narrative arcs (resolves the harness wording)

The roadmap is the acceptance authority: **at least three arc types, each present in ≥ 10 of 20 seeds.**
Per-seed arc counts are reported as a diagnostic only. Arc predicates are declared in
`tools/arcs.ts` as pure functions over the recorded history (dated events + counters), never keyword
matching. The player-blight arc is driven by an explicit harness command, because a no-input run cannot
contain player input.

## 5. Save schema v2

| Shard | Content |
|---|---|
| `meta` | header, recipe, report, RNG states, counters, **schemaVersion 2** |
| `terrain` | unchanged 12-grid binary block |
| `settlements` | base identity (position, civ, tier, name, foundedDay) — unchanged layout |
| `civs` | capital, colour, name |
| `society` | **new**: cohorts, stocks, caps, treasury, health, stability, literacy, infrastructure, culture, technology, relations, routes, wars, event ring, chronicle, decision ring |

v2 is a superset of v1; `SHARD_NAMES` gains `society`, so a v2 generation without it is invalid (D-36
still applies) and a v1 generation is recognised by its four-shard set plus `schemaVersion: 1`.

**Migration 1→2** is pure: decode the v1 shard set, then initialise `SocietyState` deterministically from
the legacy settlement population — cohorts are split by a fixed per-mille table whose sum is exactly
1000, with the rounding remainder added to `farmers`, so `Σ cohorts == legacy population` exactly. No
terrain regeneration, no clock, no RNG.

## 6. Integrity contract v3

`worldChecksum` gains the society block (cohort total, stocks, health/stability, relations, routes,
war flags, event count and tail ids) and bumps its domain tag to `CSM3`. `gridsChecksum` stays
domain-free so the golden content fixture remains meaningful.

## 7. Phase map (the 20 declared phases, now implemented)

| # | Phase | Cadence | Writes |
|---|---|---|---|
| 1 | climate | monthly | region precipitation/temperature anomalies, drought/flood flags |
| 2 | ecology | daily (bounded) | vegetation, fertility, fire, epidemic pressure |
| 3 | fertility | monthly | soil recovery/erosion |
| 4 | agriculture | daily | food production (carry-exact) |
| 5 | extraction | daily | wood/stone/metal |
| 6 | craft | daily | goods from metal+wood |
| 7 | consumption | daily | food/water/fuel draw, spoilage, treasuries |
| 8 | health | daily | health from sufficiency, sanitation, epidemic |
| 9 | demographics | monthly | births, deaths per cohort |
| 10 | stability | daily | stability from food/health/tax/war |
| 11 | migration | monthly | population transfers (conserving) |
| 12 | trade | monthly | route flows, tariffs |
| 13 | build | monthly | infrastructure, paid from stocks |
| 14 | military | monthly | manpower, upkeep |
| 15 | diplomacy | monthly | relations, grievances, treaties |
| 16 | war | monthly | fronts, attrition, occupation, peace |
| 17 | settlement-growth | monthly | tiers, founding, fragmentation, abandonment |
| 18 | civilization | monthly | formation, culture drift, technology |
| 19 | events | daily | state-transition events with forward causes |
| 20 | chronicle | yearly | per-civ yearly aggregates |

## 8. Invariants

INV-1…INV-10 keep their meaning. Stage 3 adds: cohort sum equals population; stocks non-negative and
within caps; workforce shares sum to 1000 ‰; relations within ±100; every event cause resolves to an
earlier event; no route references a missing settlement; war participants are distinct and living.

## 9. What Stage 3 deliberately does not do

Individual citizens, tactical battles, religion as a separate system, navies, espionage, dynasties,
wonder construction, cloud/multiplayer, and any Stage 4 interface work. Government forms are P1 and are
implemented only after every P0 acceptance gate is green.
