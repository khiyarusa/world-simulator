import { describe, expect, it } from 'vitest';
import { Rng, STREAM, cellHash, mix32, seedState } from '../../src/core/rng.ts';

describe('xoshiro128** rng', () => {
  it('repeats exactly for the same seed and stream', () => {
    const a = Rng.forStream(0x12345678, 0x9abcdef0, STREAM.TERRAIN);
    const b = Rng.forStream(0x12345678, 0x9abcdef0, STREAM.TERRAIN);
    const left = Array.from({ length: 64 }, () => a.next());
    const right = Array.from({ length: 64 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('gives different sequences for different streams of the same seed', () => {
    const terrain = Rng.forStream(7, 11, STREAM.TERRAIN);
    const moisture = Rng.forStream(7, 11, STREAM.MOISTURE);
    const t = Array.from({ length: 16 }, () => terrain.next());
    const m = Array.from({ length: 16 }, () => moisture.next());
    expect(t).not.toEqual(m);
  });

  it('does not disturb an existing stream when a new consumer is added', () => {
    const first = Rng.forStream(99, 3, STREAM.RESOURCES);
    const before = Array.from({ length: 8 }, () => first.next());
    // a new consumer appears elsewhere in the world
    Rng.forStream(99, 3, STREAM.SPAWN).next();
    const after = Array.from({ length: 8 }, () => first.next());
    expect(before).not.toEqual(after);
    // but replaying the same stream from scratch still matches the original prefix
    const replay = Rng.forStream(99, 3, STREAM.RESOURCES);
    expect(Array.from({ length: 8 }, () => replay.next())).toEqual(before);
  });

  it('resumes exactly from a stored state', () => {
    const rng = Rng.forStream(5, 6, STREAM.CLIMATE);
    for (let i = 0; i < 37; i++) rng.next();
    const snapshot = rng.state;
    const expected = Array.from({ length: 10 }, () => rng.next());
    const resumed = new Rng(snapshot);
    expect(Array.from({ length: 10 }, () => resumed.next())).toEqual(expected);
  });

  it('keeps int() inside bounds and hits every value', () => {
    const rng = Rng.forStream(1, 2, STREAM.EVENTS);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  it('rejects impossible bounds', () => {
    const rng = Rng.forStream(1, 2, STREAM.EVENTS);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(-1)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
  });

  it('never yields a probability outside 0..1 via chance()', () => {
    const rng = Rng.forStream(3, 4, STREAM.FIRE);
    for (let i = 0; i < 200; i++) expect(rng.chance(0)).toBe(false);
    for (let i = 0; i < 200; i++) expect(rng.chance(1000)).toBe(true);
  });

  it('produces a non-zero state even for a zero seed', () => {
    const state = seedState(0, 0, 0);
    expect(state.s0 | state.s1 | state.s2 | state.s3).not.toBe(0);
  });

  it('hashes cells statelessly', () => {
    const a = cellHash(1, 2, STREAM.RESOURCES, 10, 20);
    const b = cellHash(1, 2, STREAM.RESOURCES, 10, 20);
    const c = cellHash(1, 2, STREAM.RESOURCES, 11, 20);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // hash must be independent of the order it was computed in
    cellHash(0, 0, 0, 0, 0);
    expect(cellHash(1, 2, STREAM.RESOURCES, 10, 20)).toBe(a);
  });

  it('mixes deterministically', () => {
    expect(mix32(0, 0)).toBe(mix32(0, 0));
    expect(mix32(0, 0)).not.toBe(mix32(0, 1));
  });
});
