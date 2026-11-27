# WORLD STEWARDSHIP — GAMEPLAY AND CAMPAIGN DESIGN

Status: implemented in the reopened Stage 5 (D-68). This document is the authority for the campaign,
objectives, charters, progression and completion. Evidence is in
`STAGE_5_STEWARDSHIP_REPORT.md`; persistence in `SAVE_AND_DATA_MODEL.md`; visuals in `ART_BIBLE.md`.

---

## 1. The new fantasy and loop

The player is the **World Steward**, not a king. Civilizations still decide, build, trade, fight and
recover on their own. The steward chooses what a people should value, which crises to answer and
what legacy the world will remember.

The loop, implemented end to end:

**Observe → identify an opportunity or crisis → investigate its real cause → choose a legacy or
objective → issue a charter or a power → let the autonomous world respond → read the measured
consequences → complete a sustained milestone → advance an era → face the next challenge.**

Free Sandbox remains the original observer experience: no campaign state, no objectives, no charter
slots, all six layers and the four powers. Campaign is the primary mode in the creation flow.

## 2. MDA test for the core mechanics

| Mechanic | Decision | Simulation state affected | Trade-off | Feedback | Replayability |
|---|---|---|---|---|---|
| Legacy choice | Which long-term condition to pursue | Campaign milestones and objective categories | Each legacy rewards a different metric; a prosperity world may be fragile, a haven world may stagnate | Era, milestone chain, measured metrics | Five different metric families and thresholds relative to the founding baseline |
| Dynamic objective | Accept, decline or ignore a real crisis | Real settlement/civ pressure, player powers and charters | Accepting ties up one of two active slots; ignoring is allowed but the crisis can worsen | Offer card, target, deadline, progress, failure | Generated from each world's actual state; seeds differ |
| Civic charter | Which civ and which priority, with one of 1–3 slots | Real utility scores for buildings, trade, research, diplomacy and ecology | Favouring walls delays markets; a scholarship consumes coin; a dead civ cannot be helped | Active term, days left, recent decisions with the exact utility bias, outcome metrics | Civ × charter × timing choices; slots from earned seals |
| Powers | Bless/fertilize/blight/incite | Existing real stocks, fertility, relations | Cooldowns, finite amounts, cause-attributed history | Structured result, event and map | Objectives create new reasons to use them without requiring harm |
| Completion | Continue or stop at the legacy conclusion | Campaign completion flag; the world stays live | A conclusion is earned by sustained results; continuing keeps the same civilization | Legacy summary, milestones, seals, date, population | New worlds have different crises and thresholds |

## 3. Legacy paths

Every milestone threshold is **relative to the metrics measured when stewardship begins**. A harsh
world is not impossible; it is a different story.

| Legacy | Chapters (sustained conditions) | Fantasy |
|---|---|---|
| **Haven** (resilience) | Food days +10; stability/health; food and no settlement loss; population +4,000 and food security; +30 food days and two crisis-free years | Outlast hunger and plague |
| **Concord** (peacemaker) | 1/2/3/3/4 treaties and 1/2/3/4 years of peace | Choose a peace that is not enforced |
| **Prosperity** (trade) | 2/4/6/8/12 routes with rising treasury and food security | A crossroads that still feeds its people |
| **Enlightenment** (knowledge) | Literacy +10/12/20/28 and 2/4/6/8 technologies, at least one academy | Learning against the wall budget |
| **Renewal** (land) | Fertility +6/8/12/+24 and vegetation +10/20/28; a crisis-free year | Give the land back |

There is one five-chapter chain per legacy; an era advances when the current chapter is completed.
The `Trials` era is the fourth chapter: the conditions are deliberately harsher and the world is
expected to be under pressure from real wars, droughts and famines.

## 4. Objectives

Kinds: food crisis, diplomatic tension, lost trade, ecological damage, scholarship, growth. Every
offer is derived from authoritative state:

- food: a steward settlement below 20 days of food; goal ≥30 days;
- tension: a living neighbour below −15 relation; goal relation ≥0 or a real treaty;
- trade: fewer than six routes with a reachable partner; goal current routes +3;
- ecology: a settlement below 70 fertility or under a blight; goal +12 fertility and no blight;
- knowledge: average literacy below 55; goal +8 or any academy;
- growth: a large village near a town; goal the next tier.

Rules enforced in the worker:

- at most two active and two offered; one new offer per 60 days;
- no duplicate unresolved kind, 540-day cooldown after resolution;
- declining is free; an offer expires after 180 days; a missed active deadline fails it;
- no offer is generated without a valid target or when the condition is not present;
- progress, hold days, deadline and seal are persisted and deterministic;
- a failed objective can reappear after cooldown; it never softlocks the legacy chain;
- the main legacy path does not depend on a particular AI event.

## 5. Charters

One charter per civilization, 1–3 global slots, ten-year terms. A charter **only offsets the utility
score** the AI already computes; legality, affordability, war gates and resource costs still apply.

| Charter | Real effect |
|---|---|
| Food Security | +30 granary/irrigation, +24 well, +26 aqueduct |
| Trade & Prosperity | +30 market/road, +32 harbour, trade pair value ×1.15 |
| Scholarship | +34 academy/+18 temple, research points ×1.20 |
| Concord | +14 temple/+10 market, yearly relation drift +2 |
| Defence | +34 walls/barracks, +10 workshop |
| Ecological Stewardship | +28 irrigation/+22 aqueduct, extraction pressure −25 %, soil recovery +1 |

Each bias is written into the decision ring with the chosen building, so the panel answers "what
did the charter do?" with a number, not a fictional percentage. Replacing a term ends the old one;
the opportunity cost is the lost term and the slot.

## 6. Progression and rewards

- No XP, no spendable currency, no purchased power.
- Completing a dynamic objective earns one **Mandate Seal** (bounded 99).
- Each three seals unlock one additional charter slot (1 → 2 → 3). This is the only meta-resource:
  it has a source (real objectives), a use (more simultaneous priorities), a cap and no exploit
  loop beyond doing the work.
- Chapters unlock eras, new objective urgency, the legacy conclusion, and the narrative rewards of
  the board. No charter makes the simulation trivial; costs and gates remain.

## 7. Completion and continuation

Five completed chapters set `completed` and record a historic event. The board shows a legacy
conclusion: the people, the years, seals, milestones and the measured population. The world is not
reset or deleted; the player can close the board and continue in endless stewardship. Free Sandbox
and all six layers remain available.

## 8. Failure and recovery

- A steward people can be destroyed. The board then offers a **successor people**; earned
  milestones and seals are kept, live objectives are closed, and a new baseline is measured.
- A missed objective fails without deleting progress; the legacy chapter chain is independent of
  any single objective.
- A v4 save loads as Free Sandbox; a v5 campaign with a missing block is corrupt and recovers via
  the existing previous-generation rule.

## 9. UI flow

1. Creation: **Stewardship Campaign** (prominent) or **Free Sandbox**; choose one of five legacies.
2. World is born; the campaign board opens on **Choose your people** with the real civs, capitals
   and populations.
3. Board: era, steward, seals/slots, next chapter, all five chapters with sustained-day progress,
   offers/active objectives, charters, measured metrics, conclusion.
4. Map: a gold steward ring on the capital, objective diamonds on their real targets, civ-coloured
   halos on chartered capitals, a legacy strip with era and chapter count.
5. Existing six panels remain; the campaign is a board sheet, not a seventh information layer.

## 10. Balance and QA

- Thresholds are calibrated relative to the start; the 50-year scripted journey reaches era 3,
  offers eight objectives and issues charters with zero invariant failures (CI `campaign`).
- A controlled food crisis completes a food objective after a real recovery (unit test).
- The five legacy chains are each driven to completion in a deterministic unit test.
- A charter must produce a recorded utility bias; the no-charter control must produce none.
- Save/load preserves objectives, charters, seals, milestones and the checksum.
- Free Sandbox is unchanged and has no campaign chrome.

## 11. Explicit limits

- The five legacies use the same chapter machinery with genuinely different metrics, not five
  hand-authored mission scripts.
- Objectives are generated from six condition families; they are real, bounded and explainable,
  but they are not bespoke narrative arcs.
- Charter effects are concentrated at five decision sites (build, trade, research, diplomacy,
  ecology); they are measurable, not a full policy simulation.
- The conclusion is a designed summary, not a cinematic.
