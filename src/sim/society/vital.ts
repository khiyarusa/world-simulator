/**
 * The vital-event ring: a small second ring that preserves severity-4/5 history when the main 20,000
 * event ring wraps. A severe event is written to both rings with the same stable id, so a cause chain
 * can resolve an ancestor that the main ring has already evicted (docs/STAGE_3_DESIGN.md §9.3).
 */
export const VITAL_CAPACITY = 4_096;

export interface VitalRing {
  count: number;
  head: number;
  id: Int32Array;
  day: Int32Array;
  type: Uint8Array;
  severity: Uint8Array;
  place: Uint16Array;
  actorA: Uint8Array;
  actorB: Uint8Array;
  magnitude: Int16Array;
  cause: Int32Array;
}

export function allocateVitalRing(): VitalRing {
  return {
    count: 0,
    head: 0,
    id: new Int32Array(VITAL_CAPACITY),
    day: new Int32Array(VITAL_CAPACITY),
    type: new Uint8Array(VITAL_CAPACITY),
    severity: new Uint8Array(VITAL_CAPACITY),
    place: new Uint16Array(VITAL_CAPACITY),
    actorA: new Uint8Array(VITAL_CAPACITY),
    actorB: new Uint8Array(VITAL_CAPACITY),
    magnitude: new Int16Array(VITAL_CAPACITY),
    cause: new Int32Array(VITAL_CAPACITY),
  };
}

/** Append one already-numbered severe event. */
export function appendVital(
  vital: VitalRing,
  id: number,
  day: number,
  type: number,
  severity: number,
  place: number,
  actorA: number,
  actorB: number,
  magnitude: number,
  cause: number,
): void {
  const index = vital.head;
  vital.id[index] = id;
  vital.day[index] = day;
  vital.type[index] = type;
  vital.severity[index] = severity;
  vital.place[index] = place;
  vital.actorA[index] = actorA;
  vital.actorB[index] = actorB;
  vital.magnitude[index] = magnitude;
  vital.cause[index] = cause;
  vital.head = (index + 1) % VITAL_CAPACITY;
  if (vital.count < VITAL_CAPACITY) vital.count++;
}

/** Oldest→newest iteration index for a ring position. */
export function vitalIndex(vital: VitalRing, ordinal: number): number {
  return (vital.head - vital.count + ordinal + VITAL_CAPACITY * 2) % VITAL_CAPACITY;
}
