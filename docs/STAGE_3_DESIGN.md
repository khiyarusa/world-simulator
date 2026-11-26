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

## 5. Save schema v3

| Shard | Content |
|---|---|
| `meta` | header, recipe, report, RNG states, counters, **schemaVersion 3**, and the complete society block |
| `terrain` | unchanged 12-grid binary block (vegetation and fertility are persisted after ecology runs) |
| `settlements` | base identity (position, civ, tier, name, foundedDay) — unchanged layout |
| `civs` | capital, colour, name |

The four-shard set is unchanged: the society block travels **inside the meta shard** (D-44), so the
Stage 2.1 completeness and recovery rules remain valid for every historical save. There is no `society`
shard and `SHARD_NAMES` does not change (this corrects an earlier draft of this document).

Schema 3 adds trade routes, treaties, wars (with their four gate values), military state, prices,
technology progress, the occupation/immunity markers and the vital-event ring. A schema-2 block still
decodes: its missing structures are empty, which is exactly the world that version described, and the
codec expands its used-civ-corner matrices into the fixed 12-civ stride. A schema-3 block missing any of
those structures is rejected as corrupt.

**Migrations** are pure and ordered: 1→2 initialises the society from the legacy population with a fixed
cohort table whose sum is exactly 1000 (remainder to farmers), and 2→3 stamps the new document version
while the codec fills the structures a v2 world never had. No terrain regeneration, no seed change, no
clock, no RNG. The migration loop verifies that each step advances exactly one version, so a step cannot
be skipped.

## 6. Integrity contract v5

`worldChecksum` covers the complete persisted state: grids, clock, recipe, every counter, every RNG
stream, settlement identity, all cohort/stock/cap/carry/price/occupation values, treasuries,
health/stability/literacy, infrastructure/flags/occupation, every culture axis, technology flag,
research progress, legitimacy/army/exhaustion, the full relation and grievance matrices, climate cells,
every route, treaty and war row (including the four gate values), every event and vital-event row,
every decision and chronicle row, and the civ identity store. Domain tag `CSM5`. `gridsChecksum` stays
domain-free so the golden content fixture remains meaningful.

## 7. Phase map (20 systems, 13 pipeline stages)

The brief allows a different number of pipeline stages if the design is formally reconciled and no
subsystem is unowned. Some systems share one pass over settlements by construction (production,
extraction and craft are one loop; consumption, health and stability are one loop), so the pipeline
declares 13 stages and each stage names its owner module.

| Design stage | Cadence | Owner | Pipeline stage |
|---|---|---|---|
| clock / calendar | daily | `core/clock.ts` | `runDay` |
| climate | monthly | `society/living.ts:runClimate` | `climate` |
| ecology / fertility | monthly | `society/ecology.ts:runEcology` | `ecology` |
| labour / occupation | monthly | `society/occupations.ts:runOccupations` | `labour` |
| agriculture, extraction, craft | daily | `society/living.ts:runProduction` | `agriculture` |
| consumption, health, stability, spoilage | daily | `society/living.ts:runConsumption` | `consumption` |
| demography + ageing | yearly | `society/living.ts:runDemographics/runAgeing` | `runDay` year end |
| migration | monthly | `society/living.ts:runMigration` | `migration` |
| trade, prices, treasury | monthly | `society/trade.ts`, `society/economy.ts` | `trade` |
| infrastructure decisions | monthly | `society/infra.ts:runConstruction` | `build` |
| military | monthly | `society/war.ts:runMilitary` | `military` |
| diplomacy and treaties | yearly | `society/diplomacy.ts` | `diplomacy` |
| war and peace | monthly | `society/war.ts:runWar` | `war` |
| settlement lifecycle and founding | monthly | `society/growth.ts:runGrowth` | `settlement-growth` |
| civilization, culture, technology | yearly/monthly | `society/civ.ts` | `civilization` |
| events | on transition | `society/state.ts:appendEvent` | emitted by owners |
| chronicle | yearly | `society/living.ts:runChronicle` | `chronicle` |

The full 22-step order in the brief is preserved as the *conceptual* order; the pipeline table above is
the authoritative implementation order. No phase is a placeholder.

## 8. Invariants

INV-1…INV-10 keep their meaning. Stage 3 adds: cohort sum equals population; stocks non-negative and
within caps; workforce shares sum to 1000 ‰; prices within 250–3000 ‰; relations within ±100; every
event cause resolves to an earlier retained event or the explicit root marker `-1`; every severity-4/5
event is present in the vital ring; no route references a missing settlement; treaty and war
participants are distinct and valid; every war's persisted gate values satisfy the gate; armies and
exhaustion are non-negative and bounded; treasuries never go negative.

## 9. What Stage 3 deliberately does not do

Individual citizens, tactical battles, religion as a separate system, navies, espionage, dynasties,
wonder construction, cloud/multiplayer, and any Stage 4 interface work. Government forms are P1 and are
implemented only after every P0 acceptance gate is green.
